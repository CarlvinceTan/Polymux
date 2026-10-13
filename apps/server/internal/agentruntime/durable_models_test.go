package agentruntime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MichaelKinsy/PiG/ai"
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

// TestPERetryAfter fails when a 429 is returned at once or the wait is not Retry-After.
// The test clock records the wait, so a real sleep is a stall.
func TestPERetryAfter(t *testing.T) {
	clock := &recordClock{}
	useClock(t, clock)
	var requests int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited","type":"rate_limit"}}`))
			return
		}
		sse(w, "after retry", nil)
	}))
	defer provider.Close()
	models := durableModels(provider.URL+"/v1", "test-key", "test-model", Client{})
	model := models.GetModel(DurableProvider, "test-model")
	if model == nil {
		t.Fatal("model not registered")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	started := time.Now()
	stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
	for event := range stream.Events(ctx) {
		if event.EventType() == ai.EventError {
			t.Fatalf("provider error: %+v", event)
		}
	}
	if time.Since(started) > time.Second {
		t.Fatal("retry slept instead of using the test clock")
	}
	if requests != 2 {
		t.Fatalf("requests=%d, want 2", requests)
	}
	if got := clock.durations(); len(got) != 1 || got[0] != 2*time.Second {
		t.Fatalf("retry wait %v, want 2s", got)
	}
	result := stream.Result()
	if result == nil || result.StopReason == ai.StopReasonError {
		t.Fatalf("retry did not recover: %+v", result)
	}
}

// TestPENoRetryOnHardStatus fails when a 400 or 401 is retried, including one whose body says overloaded.
// The 429 probe fails when no retry policy is configured, so a build that never retries cannot pass.
func TestPENoRetryOnHardStatus(t *testing.T) {
	clock := &recordClock{}
	useClock(t, clock)
	attempts := func(status int, retryAfter, body string) (int, *ai.AssistantMessage) {
		t.Helper()
		var requests int
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			if requests == 1 {
				w.Header().Set("Content-Type", "application/json")
				if retryAfter != "" {
					w.Header().Set("Retry-After", retryAfter)
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"error":{"message":"` + body + `","type":"fixture_error"}}`))
				return
			}
			sse(w, "after retry", nil)
		}))
		defer provider.Close()
		models := durableModels(provider.URL+"/v1", "test-key", "test-model", Client{})
		model := models.GetModel(DurableProvider, "test-model")
		if model == nil {
			t.Fatal("model not registered")
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
		defer cancel()
		stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
		for range stream.Events(ctx) {
		}
		return requests, stream.Result()
	}
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized} {
		requests, result := attempts(status, "30", "overloaded")
		if requests != 1 || result == nil || result.StopReason != ai.StopReasonError {
			t.Fatalf("%d retried or succeeded: requests=%d result=%+v", status, requests, result)
		}
	}
	if got := clock.durations(); len(got) != 0 {
		t.Fatalf("hard status waited %v", got)
	}
	requests, result := attempts(http.StatusTooManyRequests, "0", "overloaded")
	if requests != 2 || result == nil || result.StopReason == ai.StopReasonError {
		t.Fatalf("retry policy inactive: requests=%d result=%+v", requests, result)
	}
}
