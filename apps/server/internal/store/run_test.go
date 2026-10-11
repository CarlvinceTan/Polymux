package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

func runStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.Context(), filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err := s.Register(t.Context(), []contract.Agent{{ID: "a", Name: "Same"}, {ID: "b", Name: "Same"}}); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRunRecovery(t *testing.T) {
	s := runStore(t)
	for _, id := range []string{"active", "next"} {
		req := contract.SendRequest{ID: id, Text: "Hello", AttachmentIDs: []string{}}
		if _, _, err := s.Send(t.Context(), "a", req, []contract.Part{{Kind: "text", Text: &req.Text}}, "a"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Job(t.Context(), "a"); err != nil {
		t.Fatal(err)
	}
	run, err := s.Run(t.Context(), NewRun("active", "a", "a", "message").ID)
	if err != nil {
		t.Fatal(err)
	}
	run.Status, run.Activity, run.ToolID = "running", "tool", ptr("call")
	if err := s.RunEvent(t.Context(), "tool.start", &run, &contract.ToolActivity{ID: "call", RunID: run.ID, Name: "write", Status: "running"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Recover(t.Context()); err != nil {
		t.Fatal(err)
	}
	run, err = s.Run(t.Context(), run.ID)
	if err != nil || run.Status != "interrupted" || run.Activity != "" || run.Error == nil {
		t.Fatalf("recovery %+v %v", run, err)
	}
	next, err := s.Job(t.Context(), "a")
	if err != nil || next != "next" {
		t.Fatalf("queued work lost %s %v", next, err)
	}
	thread, err := s.Thread(t.Context(), "a")
	if err != nil || len(thread.Runs) != 1 || thread.Runs[0].JobID != "next" {
		t.Fatalf("snapshot %+v %v", thread, err)
	}
	seq := run.Seq
	if err := s.RunEvent(t.Context(), "run.done", &run, nil); err != nil || run.Seq != seq {
		t.Fatalf("terminal replay duplicated %v", err)
	}
	run.Status = "running"
	if err := s.RunEvent(t.Context(), "run.update", &run, nil); err == nil {
		t.Fatal("terminal run resurrected")
	}
}

func TestCreationQueue(t *testing.T) {
	s := runStore(t)
	a := contract.Agent{ID: "new", Name: "New"}
	data := json.RawMessage(`{"agent":{"id":"new"},"prompt":"Help"}`)
	task := "Do this only after introducing yourself"
	if err := s.CreateDefinition(t.Context(), a, data, &task); err != nil {
		t.Fatal(err)
	}
	job, err := s.Job(t.Context(), a.ID)
	if err != nil || job != "created:new" {
		t.Fatalf("intro order %s %v", job, err)
	}
	work, err := s.Work(t.Context(), job)
	if err != nil || work.Trigger != "created" || work.Message.ThreadID != a.ID {
		t.Fatalf("work %+v %v", work, err)
	}
	if err := s.Finish(t.Context(), job); err != nil {
		t.Fatal(err)
	}
	job, err = s.Job(t.Context(), a.ID)
	if err != nil || job != "initial:new" {
		t.Fatalf("initial task order %s %v", job, err)
	}
	history, err := s.Messages(t.Context(), a.ID, 0, 20)
	if err != nil || len(history) != 1 || Text(history[0]) != task {
		t.Fatalf("synthetic intro leaked %+v %v", history, err)
	}
}

func TestPeerReceipts(t *testing.T) {
	s := runStore(t)
	parent := NewRun("request", "a", "a", "message")
	parent.Status = "running"
	if err := s.RunEvent(t.Context(), "run.start", &parent, nil); err != nil {
		t.Fatal(err)
	}
	text := "Only this explicit task"
	work := Work{Trigger: "peer", Message: contract.Message{ID: "delivery", ThreadID: "b", Role: "user", Parts: []contract.Part{{Kind: "text", Text: &text}}, CreatedAt: Now()}, ParentRunID: &parent.ID, DeliveryID: "delivery"}
	delivery := contract.PeerDelivery{ID: "delivery", SourceAgentID: "a", TargetAgentID: "b", ConversationID: "a", ParentRunID: parent.ID, Intent: "request", Status: "queued", CreatedAt: Now()}
	if _, err := s.Deliver(t.Context(), delivery, work, true); err != nil {
		t.Fatal(err)
	}
	before, _ := s.Events(t.Context(), "a", 0, 100)
	work.Message.CreatedAt = Now()
	if _, err := s.Deliver(t.Context(), delivery, work, true); err != nil {
		t.Fatalf("idempotent delivery rejected: %v", err)
	}
	work.Task = "Changed"
	if _, err := s.Deliver(t.Context(), delivery, work, true); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflict %v", err)
	}
	after, _ := s.Events(t.Context(), "a", 0, 100)
	if len(after) != len(before) {
		t.Fatal("duplicate delivery emitted event")
	}
	job, err := s.Job(t.Context(), "b")
	if err != nil || job != "delivery" {
		t.Fatalf("peer not queued %s %v", job, err)
	}
	if _, err := s.Job(t.Context(), "b"); err == nil {
		t.Fatal("duplicate peer work")
	}
	run, err := s.Run(t.Context(), NewRun("delivery", "b", "b", "peer").ID)
	if err != nil {
		t.Fatal(err)
	}
	run.Status = "completed"
	if err := s.RunEvent(t.Context(), "run.done", &run, nil); err != nil {
		t.Fatal(err)
	}
	answer := "Result"
	result := contract.Message{Parts: []contract.Part{{Kind: "text", Text: &answer}}}
	for range 2 {
		if err := s.Receipt(t.Context(), "delivery", run, result); err != nil {
			t.Fatal(err)
		}
	}
	messages, err := s.Messages(t.Context(), "a", 0, 100)
	if err != nil || len(messages) != 1 || Text(messages[0]) != answer || *messages[0].AgentID != "b" {
		t.Fatalf("receipt %+v %v", messages, err)
	}
}

func TestLeadPersists(t *testing.T) {
	s := runStore(t)
	group, err := s.CreateThread(t.Context(), "group", contract.CreateThreadRequest{AgentIDs: []string{"a", "b"}, LeadAgentID: ptr("b")})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateThread(t.Context(), group.ID, contract.UpdateThreadRequest{Title: "Changed", AgentIDs: []string{"a", "b"}}); err != nil {
		t.Fatal(err)
	}
	group, err = s.Thread(t.Context(), group.ID)
	if err != nil || group.LeadAgentID == nil || *group.LeadAgentID != "b" {
		t.Fatalf("lead changed %+v %v", group, err)
	}
	if err := s.UpdateThread(t.Context(), group.ID, contract.UpdateThreadRequest{Title: "Bad", LeadAgentID: ptr("missing")}); !errors.Is(err, ErrMembers) {
		t.Fatal("invalid lead accepted", err)
	}
	if err := s.UpdateThread(t.Context(), group.ID, contract.UpdateThreadRequest{Title: "Solo", AgentIDs: []string{"a"}}); err != nil {
		t.Fatal(err)
	}
	group, _ = s.Thread(t.Context(), group.ID)
	if *group.LeadAgentID != "a" {
		t.Fatal("removed lead retained")
	}
}

func ptr(text string) *string { return &text }

func TestFinishIdentity(t *testing.T) {
	s := runStore(t)
	for _, test := range []struct{ id, thread string }{{"m", "a"}, {"m:next", "b"}, {"M", "b"}} {
		request := contract.SendRequest{ID: test.id, Text: "Hello", AttachmentIDs: []string{}}
		if _, _, err := s.Send(t.Context(), test.thread, request, []contract.Part{{Kind: "text", Text: &request.Text}}, test.thread); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Finish(t.Context(), "m"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"m:next", "M"} {
		run, err := s.Run(t.Context(), NewRun(id, "b", "b", "message").ID)
		if err != nil || run.Status != "queued" {
			t.Fatalf("unrelated job changed %+v %v", run, err)
		}
	}
}

func TestWithdrawAtomic(t *testing.T) {
	s := runStore(t)
	req := contract.SendRequest{ID: "queued", Text: "Hello", AttachmentIDs: []string{}}
	if _, _, err := s.Send(t.Context(), "a", req, []contract.Part{{Kind: "text", Text: &req.Text}}, "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(t.Context(), `CREATE TRIGGER reject_done BEFORE INSERT ON events WHEN json_extract(NEW.data,'$.type')='run.done' BEGIN SELECT RAISE(ABORT,'fixture failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.Withdraw(t.Context(), "a"); err == nil {
		t.Fatal("fixture did not reject withdrawal")
	}
	var status string
	if err := s.DB.QueryRowContext(t.Context(), `SELECT state FROM jobs WHERE id='queued'`).Scan(&status); err != nil || status != "queued" {
		t.Fatalf("withdrawal partially committed %s %v", status, err)
	}
	if _, err := s.DB.ExecContext(t.Context(), `DROP TRIGGER reject_done`); err != nil {
		t.Fatal(err)
	}
	if err := s.Withdraw(t.Context(), "a"); err != nil {
		t.Fatal(err)
	}
	run, err := s.Run(t.Context(), NewRun("queued", "a", "a", "message").ID)
	if err != nil || run.Status != "cancelled" {
		t.Fatalf("withdrawn work %+v %v", run, err)
	}
}
