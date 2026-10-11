package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/CarlvinceTan/luce/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/luce/apps/server/internal/contract"
	"github.com/CarlvinceTan/luce/apps/server/internal/search"
	"github.com/CarlvinceTan/luce/apps/server/internal/store"
)

func awaitRun(t *testing.T, s *store.Store, id, status string) contract.Run {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		run, err := s.Run(t.Context(), id)
		if err == nil && run.Status == status {
			return run
		}
		time.Sleep(time.Millisecond * 10)
	}
	run, err := s.Run(t.Context(), id)
	t.Fatalf("run %s did not become %s: %+v %v", id, status, run, err)
	return run
}

func TestStopPreparation(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(t.Context(), filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	started := make(chan struct{}, 1)
	index := &search.Index{Store: db, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Extractor: search.ExtractorFunc(func(ctx context.Context, _ search.Asset) (string, error) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return "", ctx.Err()
	})}
	api, err := New(t.Context(), db, Config{DataDir: dir, Definitions: []agentruntime.Definition{{Agent: contract.Agent{ID: "a", Name: "A"}}}, Factory: &testFactory{}, Index: index})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	attachment := contract.Attachment{ID: "file", Kind: "image", Name: "Photo", MimeType: "image/png", IndexingState: "pending"}
	if err := db.SaveAttachment(t.Context(), attachment, filepath.Join(dir, "file")); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	api.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/threads/a/messages", strings.NewReader(`{"id":"prepare","text":"Review","attachmentIDs":["file"]}`)))
	if recorder.Code != 202 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("preparation not started")
	}
	recorder = httptest.NewRecorder()
	api.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/threads/a/stop", strings.NewReader(`{}`)))
	if recorder.Code != 200 {
		t.Fatal(recorder.Code)
	}
	run := awaitRun(t, db, store.NewRun("prepare", "a", "a", "message").ID, "cancelled")
	if run.Error == nil || run.Error.Code != "stopped" {
		t.Fatalf("stop result %+v", run)
	}
}

type introFactory struct {
	started chan agentruntime.Definition
	release chan struct{}
	sent    chan string
}

func (f *introFactory) Open(_ context.Context, d agentruntime.Definition, _ string) (agentruntime.Session, error) {
	return &introSession{factory: f, definition: d}, nil
}

type introSession struct {
	factory    *introFactory
	definition agentruntime.Definition
}

func (s *introSession) Send(ctx context.Context, m contract.Message, emit func(agentruntime.Delta) error) (agentruntime.Result, error) {
	if s.definition.Intro {
		s.factory.started <- s.definition
		select {
		case <-s.factory.release:
		case <-ctx.Done():
			return agentruntime.Result{}, ctx.Err()
		}
	}
	s.factory.sent <- m.ID
	text := "Hello"
	if err := emit(agentruntime.Delta{Text: text}); err != nil {
		return agentruntime.Result{}, err
	}
	return agentruntime.Result{Text: text}, nil
}
func (*introSession) Abort(context.Context) error { return nil }
func (*introSession) Close() error                { return nil }
func (*introSession) Path() string                { return "intro.jsonl" }

func TestIntroQueuesUserTask(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(t.Context(), filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	f := &introFactory{started: make(chan agentruntime.Definition, 2), release: make(chan struct{}), sent: make(chan string, 4)}
	api, err := New(t.Context(), db, Config{DataDir: dir, Factory: f, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	r := httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/agents", strings.NewReader(`{"name":"Coach","role":"Guide","prompt":"Teach","initialTask":"First task"}`)))
	var a contract.Agent
	if err := json.Unmarshal(r.Body.Bytes(), &a); err != nil || r.Code != 201 {
		t.Fatal(r.Code, err)
	}
	select {
	case d := <-f.started:
		if !d.Intro || len(d.ExtraTools) != 0 || len(d.Tools) != 0 || len(d.MCP) != 0 {
			t.Fatal("intro has tools")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("intro not started")
	}
	r = httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/"+a.ID+"/messages", strings.NewReader(`{"id":"during","text":"Second task","attachmentIDs":[]}`)))
	if r.Code != 202 {
		t.Fatal(r.Code, r.Body.String())
	}
	select {
	case <-f.sent:
		t.Fatal("task steered intro")
	default:
	}
	close(f.release)
	for _, want := range []string{"created:" + a.ID, "initial:" + a.ID, "during"} {
		select {
		case got := <-f.sent:
			if got != want {
				t.Fatalf("got %s want %s", got, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("task not sent")
		}
	}
	awaitRun(t, db, store.NewRun("during", a.ID, a.ID, "message").ID, "completed")
	api.Close()
	api, err = New(t.Context(), db, Config{DataDir: dir, Factory: f})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	if _, err := db.Job(t.Context(), a.ID); err == nil {
		t.Fatal("restart queued another intro")
	}
	select {
	case <-f.started:
		t.Fatal("restart greeted again")
	default:
	}
}

func TestToolsAreRedacted(t *testing.T) {
	api, _ := startTest(t, &testFactory{})
	a := api.actors["assistant"]
	a.mu.Lock()
	a.session = &cycleSession{}
	a.mu.Unlock()
	request := contract.SendRequest{ID: "cycle", Text: "Use tools", AttachmentIDs: []string{}}
	if _, _, err := api.Store.Send(t.Context(), "assistant", request, []contract.Part{{Kind: "text", Text: &request.Text}}, "assistant"); err != nil {
		t.Fatal(err)
	}
	runID := store.NewRun("cycle", "assistant", "assistant", "message").ID
	awaitRun(t, api.Store, runID, "completed")
	events, err := api.Store.Events(t.Context(), "assistant", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, event := range events {
		if event.Tool != nil {
			kinds = append(kinds, event.Type)
			if event.Tool.ID != "call" || event.Tool.RunID != runID {
				t.Fatal("tool correlation lost")
			}
		}
		data, _ := json.Marshal(event)
		if strings.Contains(string(data), "secret") {
			t.Fatal("tool payload leaked")
		}
	}
	if strings.Join(kinds, ",") != "tool.start,tool.done" {
		t.Fatalf("events %v", kinds)
	}
}

type cycleSession struct{}

func (*cycleSession) Send(_ context.Context, _ contract.Message, emit func(agentruntime.Delta) error) (agentruntime.Result, error) {
	for _, d := range []agentruntime.Delta{{Kind: "generating"}, {Kind: "tool.start", ToolID: "call", Tool: "read", Args: "secret"}, {Kind: "tool.done", ToolID: "call", Tool: "read"}, {Text: "Done"}} {
		if err := emit(d); err != nil {
			return agentruntime.Result{}, err
		}
	}
	return agentruntime.Result{Text: "Done"}, nil
}
func (*cycleSession) Abort(context.Context) error { return nil }
func (*cycleSession) Close() error                { return nil }
func (*cycleSession) Path() string                { return "cycle.jsonl" }

type peerFactory struct {
	received chan contract.Message
	refused  chan bool
	blocked  bool
}

func (f *peerFactory) Open(_ context.Context, d agentruntime.Definition, path string) (agentruntime.Session, error) {
	if d.Agent.ID == "b" && (path != "" || !strings.HasPrefix(d.Scope, "peer-")) {
		return nil, errors.New("peer session inherited private history")
	}
	if d.Agent.ID == "b" {
		for _, tool := range d.ExtraTools {
			if tool.Name() == "track_work" {
				return nil, errors.New("peer session can access private scratchpad")
			}
		}
	}
	return &peerSession{factory: f, definition: d}, nil
}

type peerSession struct {
	factory    *peerFactory
	definition agentruntime.Definition
}

func (s *peerSession) Send(ctx context.Context, m contract.Message, emit func(agentruntime.Delta) error) (agentruntime.Result, error) {
	text := "Peer result"
	for _, tool := range s.definition.ExtraTools {
		if tool.Name() != "message_agent" {
			continue
		}
		if s.definition.Agent.ID == "a" {
			if _, err := tool.Execute(ctx, "peer", json.RawMessage(`{"agent_id":"b","message":"Only the public task","intent":"request"}`), nil); err != nil {
				return agentruntime.Result{}, err
			}
			text = "Queued peer work"
		} else {
			s.factory.received <- m
			_, err := tool.Execute(ctx, "recursive", json.RawMessage(`{"agent_id":"a","message":"Loop back","intent":"request"}`), nil)
			s.factory.refused <- (err != nil)
			if s.factory.blocked {
				<-ctx.Done()
				return agentruntime.Result{}, ctx.Err()
			}
		}
	}
	if err := emit(agentruntime.Delta{Text: text}); err != nil {
		return agentruntime.Result{}, err
	}
	return agentruntime.Result{Text: text}, nil
}
func (*peerSession) Abort(context.Context) error { return nil }
func (*peerSession) Close() error                { return nil }
func (s *peerSession) Path() string              { return s.definition.Agent.ID + ".jsonl" }

func TestPeerIsolation(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(t.Context(), filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	f := &peerFactory{received: make(chan contract.Message, 1), refused: make(chan bool, 1)}
	api, err := New(t.Context(), db, Config{DataDir: dir, Definitions: []agentruntime.Definition{{Agent: contract.Agent{ID: "a", Name: "A"}, Prompt: "PRIVATE_PROMPT"}, {Agent: contract.Agent{ID: "b", Name: "B"}}}, Factory: f, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	r := httptest.NewRecorder()
	if err := db.SaveSession(t.Context(), "b", "private-history.jsonl"); err != nil {
		t.Fatal(err)
	}
	if err := db.SaveWork(t.Context(), store.NewRun("private", "b", "b", "message"),
		store.WorkItem{ID: "private", Text: "PRIVATE_OPEN_WORK", State: "open"}); err != nil {
		t.Fatal(err)
	}
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/a/messages", strings.NewReader(`{"id":"peer-start","text":"PRIVATE_USER_TEXT; give the peer only the public task","attachmentIDs":[]}`)))
	if r.Code != 202 {
		t.Fatal(r.Code, r.Body.String())
	}
	select {
	case received := <-f.received:
		text := store.Text(received)
		private := strings.Contains(text, "PRIVATE_USER_TEXT") || strings.Contains(text, "PRIVATE_PROMPT")
		if private || strings.Contains(text, "PRIVATE_OPEN_WORK") || !strings.Contains(text, "Only the public task") {
			t.Fatal("peer disclosure was not bounded", text)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("peer never ran")
	}
	if !<-f.refused {
		t.Fatal("peer request recursively woke source")
	}
	awaitRun(t, db, store.NewRun("peer-start", "a", "a", "message").ID, "completed")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		messages, err := db.Messages(t.Context(), "a", 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range messages {
			if m.AgentID != nil && *m.AgentID == "b" && store.Text(m) == "Peer result" {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("correlated peer result not published to source")
}

func TestDeletePeerSource(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(t.Context(), filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	f := &peerFactory{received: make(chan contract.Message, 1), refused: make(chan bool, 1), blocked: true}
	definitions := []agentruntime.Definition{{Agent: contract.Agent{ID: "a", Name: "A"}}, {Agent: contract.Agent{ID: "b", Name: "B"}}}
	api, err := New(t.Context(), db, Config{DataDir: dir, Definitions: definitions, Factory: f})
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	r := httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/a/messages", strings.NewReader(`{"id":"origin","text":"Ask the peer","attachmentIDs":[]}`)))
	if r.Code != 202 {
		t.Fatal(r.Code, r.Body.String())
	}
	var message contract.Message
	select {
	case message = <-f.received:
	case <-time.After(3 * time.Second):
		t.Fatal("peer never started")
	}
	awaitRun(t, db, store.NewRun("origin", "a", "a", "message").ID, "waiting_peer")
	r = httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodDelete, "/agents/a", nil))
	if r.Code != 200 {
		t.Fatal(r.Code, r.Body.String())
	}
	awaitRun(t, db, store.NewRun(message.ID, "b", "b", "peer").ID, "cancelled")
	var pending int
	if err := db.DB.QueryRowContext(t.Context(), `SELECT count(*) FROM deliveries WHERE json_extract(data,'$.status')='queued'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("source deletion orphaned a delivery: %d %v", pending, err)
	}
}

type openingFactory struct{ started chan struct{} }

func (f *openingFactory) Open(ctx context.Context, _ agentruntime.Definition, _ string) (agentruntime.Session, error) {
	close(f.started)
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestStopOpening(t *testing.T) {
	f := &openingFactory{started: make(chan struct{})}
	api, _ := startTest(t, f)
	r := httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/assistant/messages", strings.NewReader(`{"id":"opening","text":"Hello","attachmentIDs":[]}`)))
	if r.Code != 202 {
		t.Fatal(r.Code)
	}
	select {
	case <-f.started:
	case <-time.After(3 * time.Second):
		t.Fatal("session did not begin opening")
	}
	r = httptest.NewRecorder()
	api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/assistant/stop", strings.NewReader(`{}`)))
	if r.Code != 200 {
		t.Fatal(r.Code)
	}
	awaitRun(t, api.Store, store.NewRun("opening", "assistant", "assistant", "message").ID, "cancelled")
}

func TestPersistenceCleanup(t *testing.T) {
	for _, test := range []struct{ name, condition string }{
		{"start", `json_extract(NEW.data,'$.type')='message.start' AND json_extract(NEW.data,'$.message.role')='assistant'`},
		{"finish", `json_extract(NEW.data,'$.type')='run.done' AND json_extract(NEW.data,'$.run.status')='completed'`},
	} {
		t.Run(test.name, func(t *testing.T) {
			api, _ := startTest(t, &testFactory{})
			if _, err := api.Store.DB.ExecContext(t.Context(), `CREATE TRIGGER reject_write BEFORE INSERT ON events WHEN `+test.condition+` BEGIN SELECT RAISE(ABORT,'fixture failure'); END`); err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRecorder()
			api.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/threads/assistant/messages", strings.NewReader(`{"id":"fault","text":"Hello","attachmentIDs":[]}`)))
			if r.Code != 202 {
				t.Fatal(r.Code, r.Body.String())
			}
			runID := store.NewRun("fault", "assistant", "assistant", "message").ID
			awaitRun(t, api.Store, runID, "interrupted")
			events, err := api.Store.Events(t.Context(), "assistant", 0, 100)
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range events {
				if event.RunID == nil || *event.RunID != runID {
					continue
				}
				if event.Type == "message.done" || event.Run != nil && event.Run.Status == "completed" {
					t.Fatal("failed finalization advertised completion")
				}
			}
		})
	}
}
