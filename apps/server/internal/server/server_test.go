package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

type testFactory struct {
	calls atomic.Int32
	block bool
}

func (f *testFactory) Open(context.Context, agentruntime.Definition, string) (agentruntime.Session, error) {
	return &testSession{factory: f}, nil
}

type testSession struct{ factory *testFactory }

func (s *testSession) Send(ctx context.Context, _ contract.Message, emit func(agentruntime.Delta) error) (agentruntime.Result, error) {
	s.factory.calls.Add(1)
	if err := emit(agentruntime.Delta{Text: "Hello "}); err != nil {
		return agentruntime.Result{}, err
	}
	if s.factory.block {
		<-ctx.Done()
		return agentruntime.Result{}, ctx.Err()
	}
	if err := emit(agentruntime.Delta{Text: "there"}); err != nil {
		return agentruntime.Result{}, err
	}
	return agentruntime.Result{Text: "Hello there"}, nil
}
func (*testSession) Abort(context.Context) error { return nil }
func (*testSession) Close() error                { return nil }
func (*testSession) Path() string                { return "test.jsonl" }

func startTest(t *testing.T, f Factory) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.Open(t.Context(), filepath.Join(dir, "db"))
	if err != nil {
		t.Fatal(err)
	}
	api, err := New(t.Context(), s, Config{DataDir: dir, Definitions: []agentruntime.Definition{{Agent: contract.Agent{ID: "assistant", Name: "Assistant"}}}, Factory: f, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(api)
	t.Cleanup(func() { httpServer.Close(); api.Close(); s.Close() })
	return api, httpServer
}

func TestSendReplayAndSSE(t *testing.T) {
	f := &testFactory{}
	api, server := startTest(t, f)
	body := `{"id":"u","text":"hello","attachmentIDs":[]}`
	for n := 0; n < 2; n++ {
		response, err := http.Post(server.URL+"/threads/assistant/messages", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if n == 0 && response.StatusCode != 202 || n == 1 && response.StatusCode != 200 {
			t.Fatalf("send status %d", response.StatusCode)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	for f.calls.Load() != 1 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	for time.Now().Before(deadline) {
		messages, err := api.Store.Messages(t.Context(), "assistant", 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		if len(messages) == 2 && messages[1].Status == "done" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	messages, err := api.Store.Messages(t.Context(), "assistant", 0, 100)
	if err != nil || len(messages) != 2 || store.Text(messages[1]) != "Hello there" || messages[1].ReplyToID == nil || *messages[1].ReplyToID != "u" {
		t.Fatalf("messages %+v %v", messages, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/threads/assistant/stream?after=2", nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	var event contract.Event
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(line, "data: ") {
			if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data: "))), &event); err != nil {
				t.Fatal(err)
			}
			break
		}
	}
	if event.Seq != 3 || event.Type != "run.start" || event.Run == nil || event.Run.Status != "queued" {
		t.Fatalf("SSE replay %+v", event)
	}
	if f.calls.Load() != 1 {
		t.Fatalf("duplicate model run: %d", f.calls.Load())
	}
}

func TestCombinedSendQuotesOnePart(t *testing.T) {
	f := &testFactory{}
	api, web := startTest(t, f)
	caption := "Two images"
	first := contract.Attachment{ID: "first", Kind: "image", Name: "Same.png", MimeType: "image/png", IndexingState: "ready"}
	second := first
	second.ID = "second"
	for _, attachment := range []contract.Attachment{first, second} {
		if err := api.Store.SaveAttachment(t.Context(), attachment, filepath.Join(t.TempDir(), attachment.ID)); err != nil {
			t.Fatal(err)
		}
	}
	original := contract.Message{ID: "original", ThreadID: "assistant", Role: "assistant", Status: "done", Parts: []contract.Part{
		{Kind: "text", Text: &caption}, {Kind: "attachment", Attachment: &first}, {Kind: "attachment", Attachment: &second}, {Kind: "tool"}}}
	if _, err := api.Store.Append(t.Context(), contract.Event{ConversationID: "assistant", Type: "message.done"}, &original); err != nil {
		t.Fatal(err)
	}
	body := `{"id":"combined","text":"This one","attachmentIDs":["first","second"],"replyToID":"original","replyPart":2}`
	for _, status := range []int{202, 200} {
		response, err := http.Post(web.URL+"/threads/assistant/messages", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var message contract.Message
		err = json.NewDecoder(response.Body).Decode(&message)
		response.Body.Close()
		if err != nil || response.StatusCode != status || len(message.Parts) != 3 || message.Reply == nil || message.Reply.PartIndex == nil || *message.Reply.PartIndex != 2 || message.Reply.Text != "" || message.Reply.Attachment == nil || message.Reply.Attachment.ID != second.ID {
			t.Fatalf("combined send response %d %+v %v", response.StatusCode, message, err)
		}
	}
	deadline := time.Now().Add(3 * time.Second)
	var messages []contract.Message
	for time.Now().Before(deadline) {
		messages, _ = api.Store.Messages(t.Context(), "assistant", 0, 100)
		if len(messages) == 3 && messages[2].Status == "done" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(messages) != 3 || messages[2].Status != "done" || len(messages[2].Parts) != 1 || messages[2].Parts[0].Kind != "text" || f.calls.Load() != 1 {
		t.Fatalf("combined send duplicated turns or streaming text %+v calls=%d", messages, f.calls.Load())
	}
	for _, test := range []struct {
		name, body string
		status     int
	}{
		{"selector-conflict", `{"id":"combined","text":"This one","attachmentIDs":["first","second"],"replyToID":"original","replyPart":1}`, 409},
		{"tool", `{"id":"bad-tool","text":"Reply","attachmentIDs":[],"replyToID":"original","replyPart":3}`, 400},
		{"negative", `{"id":"bad-negative","text":"Reply","attachmentIDs":[],"replyToID":"original","replyPart":-1}`, 400},
		{"range", `{"id":"bad-range","text":"Reply","attachmentIDs":[],"replyToID":"original","replyPart":4}`, 400},
		{"missing-message", `{"id":"bad-missing","text":"Reply","attachmentIDs":[],"replyPart":0}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := http.Post(web.URL+"/threads/assistant/messages", "application/json", strings.NewReader(test.body))
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("response %d want %d", response.StatusCode, test.status)
			}
		})
	}
	var jobs int
	if err := api.Store.DB.QueryRowContext(t.Context(), `SELECT count(*) FROM jobs`).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("one send created extra jobs %d %v", jobs, err)
	}
}

func TestStopPersistsError(t *testing.T) {
	f := &testFactory{block: true}
	api, server := startTest(t, f)
	response, err := http.Post(server.URL+"/threads/assistant/messages", "application/json", strings.NewReader(`{"id":"u","text":"hello","attachmentIDs":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	deadline := time.Now().Add(3 * time.Second)
	for f.calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	response, err = http.Post(server.URL+"/threads/assistant/stop", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	for time.Now().Before(deadline) {
		messages, err := api.Store.Messages(t.Context(), "assistant", 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		if len(messages) == 2 && messages[1].Status == "error" {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("abort did not settle assistant message")
}
