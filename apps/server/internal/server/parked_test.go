package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/CarlvinceTan/luce/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/luce/apps/server/internal/testenv"
)

// A parked task must reappear on the next user turn, or the agent silently forgets it.
func TestParkedTaskSurfacesOnAUserTurn(t *testing.T) {
	testenv.PiG(t)
	var mu sync.Mutex
	var bodies []string
	var turns atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := json.Marshal(json.RawMessage(mustRead(t, r)))
		mu.Lock()
		bodies = append(bodies, string(body))
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		if turns.Add(1) == 1 {
			calls := []map[string]any{{"index": 0, "id": "park", "type": "function", "function": map[string]string{
				"name": "manage_tasks", "arguments": `{"action":"checkpoint","goal":"Draft the fixture report","next":"Ask which format you want","wait_for_user":true}`,
			}}}
			data, _ := json.Marshal(map[string]any{"id": "fixture", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "tool_calls": calls}, "finish_reason": nil}}})
			fmt.Fprintf(w, "data: %s\n\n", data)
			fmt.Fprint(w, "data: {\"id\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		fmt.Fprint(w, "data: {\"id\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Noted\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	runtime, err := agentruntime.New(t.TempDir(), provider.URL+"/v1", "local/test", "test-key", agentruntime.Client{})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	api, endpoint := startTest(t, runtime)
	send := func(id string) {
		t.Helper()
		response, err := http.Post(endpoint.URL+"/threads/assistant/messages", "application/json",
			strings.NewReader(`{"id":"`+id+`","text":"Keep going","attachmentIDs":[]}`))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
	}
	send("first")
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		tasks, err := api.Store.Tasks(t.Context(), "assistant", "assistant")
		if err != nil {
			t.Fatal(err)
		}
		if len(tasks) > 0 && tasks[0].Status == "parked" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	tasks, err := api.Store.Tasks(t.Context(), "assistant", "assistant")
	if err != nil || len(tasks) == 0 || tasks[0].Status != "parked" {
		t.Fatalf("task did not park: %+v %v", tasks, err)
	}
	send("second")
	deadline = time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if turns.Load() > 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) < 2 {
		t.Fatalf("expected a second turn, got %d", len(bodies))
	}
	if !strings.Contains(bodies[1], "Tasks waiting on your answer") || !strings.Contains(bodies[1], "Draft the fixture report") {
		t.Fatalf("parked task was not surfaced: %s", bodies[1][:min(len(bodies[1]), 600)])
	}
	if strings.Contains(bodies[0], "Tasks waiting on your answer") {
		t.Fatal("first turn claimed parked work")
	}
}

func mustRead(t *testing.T, r *http.Request) []byte {
	t.Helper()
	defer r.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil
	}
	return raw
}
