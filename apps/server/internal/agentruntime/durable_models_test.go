package agentruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/MichaelKinsy/PiG/ai"
	"github.com/MichaelKinsy/PiG/durable/storage"
)

// Isolates the models layer: does Polymux's OpenAI-compatible endpoint stream through PiG?
func TestDurableModelsStream(t *testing.T) {
	var requests int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		t.Logf("request %d to %s", requests, r.URL.Path)
		sse(w, "READY", nil)
	}))
	defer provider.Close()
	models := durableModels(provider.URL+"/v1", "test-key", "test-model", Client{})
	model := models.GetModel(DurableProvider, "test-model")
	if model == nil {
		t.Fatal("model not registered")
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
	for event := range stream.Events(ctx) {
		t.Logf("event %s", event.EventType())
		if event.EventType() == ai.EventError {
			t.Fatalf("provider error: %+v", event)
		}
	}
	result := stream.Result()
	if result == nil {
		t.Fatal("no terminal result")
	}
	if requests == 0 {
		t.Fatal("no provider request was made")
	}
}

func TestDurableModelsRegistersEveryModel(t *testing.T) {
	models := durableModels("http://localhost/v1", "", "local/opencode", Client{}, "local/codex", "local/cursor-agent", "local/codex")
	for _, id := range []string{"local/opencode", "local/codex", "local/cursor-agent"} {
		if models.GetModel(DurableProvider, id) == nil {
			t.Errorf("model %s not registered", id)
		}
	}
	if models.GetModel(DurableProvider, "missing") != nil {
		t.Fatal("unknown model registered")
	}
}

func TestDurableModelsSendsOwnModelID(t *testing.T) {
	requests := make(chan string, 4)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.Header.Get("X-Bridge") != "shared" {
			t.Error("missing shared header")
		}
		requests <- body.Model
		sse(w, "READY", nil)
	}))
	defer provider.Close()
	models := durableModels(provider.URL+"/v1", "test-key", "local/opencode", Client{Headers: map[string]string{"X-Bridge": "shared"}}, "local/codex", "local/cursor-agent")
	for _, id := range []string{"local/opencode", "local/codex", "local/cursor-agent"} {
		t.Run(id, func(t *testing.T) {
			model := models.GetModel(DurableProvider, id)
			if model == nil {
				t.Fatal("model not registered")
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
			for event := range stream.Events(ctx) {
				if event.EventType() == ai.EventError {
					t.Fatalf("provider error: %+v", event)
				}
			}
			select {
			case got := <-requests:
				if got != id {
					t.Fatalf("request model = %q, want %q", got, id)
				}
			default:
				t.Fatal("no request")
			}
		})
	}
}

func TestDurableAgentOnNonDefaultModelReplies(t *testing.T) {
	for _, id := range []string{"local/codex", "missing"} {
		t.Run(id, func(t *testing.T) {
			var hits atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); sse(w, "READY", nil) }))
			defer provider.Close()
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			runtime, err := NewDurable(ctx, t.TempDir(), provider.URL+"/v1", "local/opencode", "test-key", Client{}, storage.NewMemoryStorage(), "local/codex")
			if err != nil {
				t.Fatal(err)
			}
			defer runtime.Close()
			session, err := runtime.Open(ctx, Definition{Agent: contract.Agent{ID: "assistant", Name: "Assistant", Model: id}}, "")
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			result, err := session.Send(ctx, turn("hi"), nil)
			if id == "missing" {
				if err == nil || err.Error() != "the agent did not answer" {
					t.Fatalf("unregistered model error = %v", err)
				}
				if hits.Load() != 0 {
					t.Fatal("unknown model called provider")
				}
			} else if err != nil || result.Text != "READY" {
				t.Fatalf("turn = %+v, error = %v", result, err)
			}
		})
	}
}
