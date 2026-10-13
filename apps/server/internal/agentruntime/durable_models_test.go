package agentruntime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/testenv"
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

// TestPERetryAfter fails when a 429 is returned at once or retried without waiting out Retry-After.
// A wait past the test bound is a stall, not a pass.
func TestPERetryAfter(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		times = append(times, time.Now())
		n := len(times)
		mu.Unlock()
		if n == 1 {
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
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	started := time.Now()
	stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
	for event := range stream.Events(ctx) {
		if event.EventType() == ai.EventError {
			t.Fatalf("provider error: %+v", event)
		}
	}
	elapsed := time.Since(started)
	mu.Lock()
	got := append([]time.Time(nil), times...)
	mu.Unlock()
	if len(got) < 2 && elapsed >= 7*time.Second {
		t.Fatalf("stall: retry did not start a second attempt within %s (requests=%d)", elapsed, len(got))
	}
	if len(got) != 2 {
		t.Fatalf("requests=%d, want 2", len(got))
	}
	gap := got[1].Sub(got[0])
	if gap < 2*time.Second {
		t.Fatalf("retry ignored Retry-After: gap %s", gap)
	}
	if gap > 8*time.Second {
		t.Fatalf("stall: retry waited %s", gap)
	}
	result := stream.Result()
	if result == nil || result.StopReason == ai.StopReasonError {
		t.Fatalf("retry did not recover: %+v", result)
	}
}

// TestPENoRetryOn401 fails when a 401 is retried, including one whose body says overloaded.
// The 429 probe fails when no retry policy is configured, so a build that never retries cannot pass.
// Retry-After: 30 on the 401 is a stall twin: honouring it would miss the test bound.
func TestPENoRetryOn401(t *testing.T) {
	attempts := func(status int, retryAfter, body string) (int, *ai.AssistantMessage, time.Duration) {
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
		ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
		defer cancel()
		started := time.Now()
		stream := models.StreamSimple(ctx, model, ai.Context{Messages: []ai.Message{ai.UserMessage{Content: ai.UserText("hi")}}})
		for range stream.Events(ctx) {
		}
		return requests, stream.Result(), time.Since(started)
	}
	requests, result, elapsed := attempts(http.StatusUnauthorized, "30", "overloaded")
	if requests != 1 && elapsed >= 7*time.Second {
		t.Fatalf("stall: 401 still waiting after %s (requests=%d)", elapsed, requests)
	}
	if requests != 1 || result == nil || result.StopReason != ai.StopReasonError {
		t.Fatalf("401 retried or succeeded: requests=%d result=%+v", requests, result)
	}
	requests, result, elapsed = attempts(http.StatusTooManyRequests, "0", "rate limited")
	if requests < 2 && elapsed >= 7*time.Second {
		t.Fatalf("stall: retry did not start a second attempt within %s (requests=%d)", elapsed, requests)
	}
	if requests != 2 || result == nil || result.StopReason == ai.StopReasonError {
		t.Fatalf("retry policy inactive: requests=%d result=%+v", requests, result)
	}
}

// TestPERetryingEvent fails when a transient failure is retried without a run.retrying notice.
func TestPERetryingEvent(t *testing.T) {
	testenv.PiG(t)
	var mu sync.Mutex
	var requests int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		requests++
		n := requests
		mu.Unlock()
		if n == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"message":"rate limited 429","type":"rate_limit"}}`))
			return
		}
		sse(w, "after retry", nil)
	}))
	defer provider.Close()
	runtime, err := New(t.TempDir(), provider.URL+"/v1", "local/test", "test-key", Client{})
	if err != nil {
		t.Fatal(err)
	}
	defer runtime.Close()
	session, err := runtime.Open(t.Context(), Definition{
		Agent:     contract.Agent{ID: "a", Name: "A"},
		Prompt:    "Reply briefly.",
		Intro:     true,
		Ephemeral: true,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	var deltas []Delta
	var deltaMu sync.Mutex
	text := "retry me"
	started := time.Now()
	_, err = session.Send(ctx, contract.Message{Parts: []contract.Part{{Kind: "text", Text: &text}}}, func(d Delta) error {
		deltaMu.Lock()
		deltas = append(deltas, d)
		deltaMu.Unlock()
		return nil
	})
	elapsed := time.Since(started)
	deltaMu.Lock()
	got := append([]Delta(nil), deltas...)
	deltaMu.Unlock()
	retries := 0
	for _, d := range got {
		if d.Kind == "run.retrying" {
			retries++
			if d.Attempt != retries {
				t.Fatalf("run.retrying attempt %d, want %d", d.Attempt, retries)
			}
		}
	}
	if retries == 0 && elapsed >= 7*time.Second {
		t.Fatalf("stall: no run.retrying within %s", elapsed)
	}
	if err != nil {
		t.Fatal(err)
	}
	if retries != 1 {
		t.Fatalf("run.retrying events=%d, want 1", retries)
	}
}
