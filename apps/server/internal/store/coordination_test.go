package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

func peerFixture(t *testing.T) (*Store, contract.Run, contract.Run) {
	t.Helper()
	s := runStore(t)
	parent := NewRun("origin", "a", "a", "message")
	parent.Status = "running"
	if err := s.RunEvent(t.Context(), "run.start", &parent, nil); err != nil {
		t.Fatal(err)
	}
	text := "Explicit public task"
	work := Work{Trigger: "peer", Message: contract.Message{ID: "request", ThreadID: "b", Role: "user", CreatedAt: Now(), Parts: []contract.Part{{Kind: "text", Text: &text}}}, ParentRunID: &parent.ID, DeliveryID: "request"}
	delivery := contract.PeerDelivery{ID: "request", SourceAgentID: "a", TargetAgentID: "b", ConversationID: "a", ParentRunID: parent.ID, Intent: "request", Status: "queued", CreatedAt: Now()}
	if _, err := s.Deliver(t.Context(), delivery, work, true); err != nil {
		t.Fatal(err)
	}
	parent.Status = "completed"
	if err := s.RunEvent(t.Context(), "run.done", &parent, nil); err != nil {
		t.Fatal(err)
	}
	parent, err := s.Run(t.Context(), parent.ID)
	if err != nil || parent.Status != "waiting_peer" {
		t.Fatalf("source did not wait: %+v %v", parent, err)
	}
	child, err := s.Run(t.Context(), NewRun("request", "b", "b", "peer").ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, parent, child
}

func TestPeerRemoval(t *testing.T) {
	for _, target := range []string{"a", "b"} {
		t.Run(target, func(t *testing.T) {
			s, parent, child := peerFixture(t)
			if _, _, err := s.DeleteAgent(t.Context(), target); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Job(t.Context(), "b"); !errors.Is(err, sql.ErrNoRows) {
				t.Fatal("removed peer work remained executable", err)
			}
			if target == "a" {
				child, err := s.Run(t.Context(), child.ID)
				if err != nil || child.Status != "cancelled" {
					t.Fatalf("orphan request %+v %v", child, err)
				}
				if err := s.Finish(t.Context(), child.JobID); err != nil {
					t.Fatal("late worker cleanup after source deletion", err)
				}
			} else {
				parent, err := s.Run(t.Context(), parent.ID)
				if err != nil || parent.Status != "failed" {
					t.Fatalf("source still waits for deleted target %+v %v", parent, err)
				}
				var data string
				if err := s.DB.QueryRowContext(t.Context(), `SELECT data FROM deliveries WHERE id='request'`).Scan(&data); err != nil {
					t.Fatal(err)
				}
				var delivery contract.PeerDelivery
				if err := json.Unmarshal([]byte(data), &delivery); err != nil || delivery.Status != "cancelled" {
					t.Fatalf("missing terminal receipt %+v %v", delivery, err)
				}
			}
		})
	}
}

func TestStopWaiting(t *testing.T) {
	s, parent, child := peerFixture(t)
	request := contract.SendRequest{ID: "unrelated", Text: "Unrelated user message", AttachmentIDs: []string{}}
	if _, _, err := s.Send(t.Context(), "b", request, []contract.Part{{Kind: "text", Text: &request.Text}}, "b"); err != nil {
		t.Fatal(err)
	}
	ids, err := s.StopWaiting(t.Context(), "a")
	if err != nil || len(ids) != 1 || ids[0] != child.ID {
		t.Fatalf("scoped stop %v %v", ids, err)
	}
	for _, id := range []string{parent.ID, child.ID} {
		run, err := s.Run(t.Context(), id)
		if err != nil || run.Status != "cancelled" {
			t.Fatalf("run not cancelled %+v %v", run, err)
		}
	}
	if id, err := s.Job(t.Context(), "b"); err != nil || id != "unrelated" {
		t.Fatal("stop removed unrelated work", id, err)
	}
}

func TestReceiptRequiresOutcome(t *testing.T) {
	s, parent, child := peerFixture(t)
	child.Status = "completed"
	if err := s.Receipt(t.Context(), "request", child, contract.Message{}); !errors.Is(err, ErrConflict) {
		t.Fatal("unpersisted success accepted", err)
	}
	if err := s.RunEvent(t.Context(), "run.done", &child, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Receipt(t.Context(), "request", child, contract.Message{}); err != nil {
		t.Fatal(err)
	}
	parent, err := s.Run(t.Context(), parent.ID)
	if err != nil || parent.Status != "completed" {
		t.Fatalf("durable result did not resolve wait %+v %v", parent, err)
	}
}

func TestFinishRepairsReceipt(t *testing.T) {
	s, parent, child := peerFixture(t)
	child.Status = "completed"
	if err := s.RunEvent(t.Context(), "run.done", &child, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(t.Context(), child.JobID); err != nil {
		t.Fatal(err)
	}
	parent, err := s.Run(t.Context(), parent.ID)
	if err != nil || parent.Status != "completed" {
		t.Fatalf("job completion left its source waiting: %+v %v", parent, err)
	}
}
