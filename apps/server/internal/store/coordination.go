package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

func endRun(ctx context.Context, tx *sql.Tx, run *contract.Run) error {
	for _, tool := range run.Tools {
		tool.Status = run.Status
		if _, err := appendTx(ctx, tx, contract.Event{ConversationID: run.ConversationID, Type: "tool.done", RunID: &run.ID, AgentID: &run.AgentID, Tool: &tool}, nil); err != nil {
			return err
		}
	}
	run.Tools, run.ToolID, run.Activity = []contract.ToolActivity{}, nil, ""
	now := Now()
	run.FinishedAt = &now
	if run.MessageID != nil {
		var data string
		err := tx.QueryRowContext(ctx, `SELECT data FROM messages WHERE id=? AND status='streaming'`, *run.MessageID).Scan(&data)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err == nil {
			var message contract.Message
			if err := json.Unmarshal([]byte(data), &message); err != nil {
				return err
			}
			message.Status = "error"
			if _, err := appendTx(ctx, tx, contract.Event{ConversationID: run.ConversationID, Type: "message.error", RunID: &run.ID, MessageID: run.MessageID, AgentID: &run.AgentID, Error: run.Error}, &message); err != nil {
				return err
			}
		}
	}
	_, err := appendTx(ctx, tx, contract.Event{ConversationID: run.ConversationID, Type: "run.done", RunID: &run.ID, AgentID: &run.AgentID, Run: run}, nil)
	return err
}

func (s *Store) PendingPeers(ctx context.Context, agentID string) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT json_extract(data,'$.runID') FROM deliveries WHERE (source_agent=? OR target_agent=?) AND json_extract(data,'$.status')='queued'`, agentID, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id sql.NullString
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if id.Valid {
			ids = append(ids, id.String)
		}
	}
	return ids, rows.Err()
}

func closePeers(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	type item struct {
		delivery contract.PeerDelivery
		work     Work
	}
	items := []item{}
	for rows.Next() {
		var data, input string
		var peer item
		if err := rows.Scan(&data, &input); err != nil {
			rows.Close()
			return nil, err
		}
		if err := json.Unmarshal([]byte(data), &peer.delivery); err != nil {
			rows.Close()
			return nil, err
		}
		if err := json.Unmarshal([]byte(input), &peer.work); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, peer)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, peer := range items {
		run := NewRun(peer.work.Message.ID, peer.work.Message.ThreadID, peer.delivery.TargetAgentID, peer.work.Trigger)
		var data string
		err := tx.QueryRowContext(ctx, `SELECT data FROM runs WHERE id=?`, run.ID).Scan(&data)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			if err := json.Unmarshal([]byte(data), &run); err != nil {
				return nil, err
			}
		}
		if !Terminal(run.Status) {
			run.Status, run.Summary = "cancelled", "Peer request cancelled"
			run.Error = &contract.Error{Code: "stopped", Message: "This peer request was cancelled or a participant was removed."}
			if err := endRun(ctx, tx, &run); err != nil {
				return nil, err
			}
		}
		ids = append(ids, run.ID)
		if peer.delivery.Intent != "handoff" {
			if _, err := tx.ExecContext(ctx, `UPDATE jobs SET state='done' WHERE id=?`, peer.work.Message.ID); err != nil {
				return nil, err
			}
		}
		if err := receiptTx(ctx, tx, peer.delivery.ID, run, contract.Message{}); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func (s *Store) StopWaiting(ctx context.Context, thread string) ([]string, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var data string
	err = tx.QueryRowContext(ctx, `SELECT data FROM runs WHERE thread_id=? AND status='waiting_peer' AND NOT EXISTS(SELECT 1 FROM runs active WHERE active.thread_id=? AND active.status='running') ORDER BY json_extract(data,'$.createdAt') DESC LIMIT 1`, thread, thread).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var run contract.Run
	if err := json.Unmarshal([]byte(data), &run); err != nil {
		return nil, err
	}
	run.Status, run.Summary = "cancelled", "Reply stopped"
	run.Error = &contract.Error{Code: "stopped", Message: "Reply stopped."}
	if err := endRun(ctx, tx, &run); err != nil {
		return nil, err
	}
	ids, err := closePeers(ctx, tx, `SELECT data,input FROM deliveries WHERE json_extract(data,'$.parentRunID')=? AND json_extract(data,'$.status')='queued'`, run.ID)
	if err != nil {
		return nil, err
	}
	return ids, tx.Commit()
}
