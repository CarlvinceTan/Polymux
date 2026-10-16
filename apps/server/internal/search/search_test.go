package search

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

type testEmbedding struct{}

func (testEmbedding) Embed(_ context.Context, in Input) ([]float32, string, error) {
	if strings.Contains(in.Text, "orange") || strings.Contains(in.Text, "fruit") {
		return []float32{1, 0, 0}, "test", nil
	}
	return []float32{0, 1, 0}, "test", nil
}

func TestHybridScope(t *testing.T) {
	ctx := t.Context()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Register(ctx, []contract.Agent{{ID: "a"}, {ID: "b"}}); err != nil {
		t.Fatal(err)
	}
	i := &Index{Store: s, Embedder: testEmbedding{}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	for _, item := range []struct{ id, thread, text string }{{"m1", "a", "orange balloon"}, {"m2", "a", "blue bicycle"}, {"m3", "b", "fruit outside this conversation"}} {
		m := contract.Message{ID: item.id, ThreadID: item.thread, Role: "user", Parts: []contract.Part{{Kind: "text", Text: &item.text}}, Status: "done", CreatedAt: store.Now()}
		if _, err := s.Append(ctx, contract.Event{ConversationID: item.thread, Type: "message.done"}, &m); err != nil {
			t.Fatal(err)
		}
		if err := i.Ingest(ctx, m); err != nil {
			t.Fatal(err)
		}
	}
	hits, hybrid, err := i.Search(ctx, "a", "fruit")
	if err != nil || !hybrid || len(hits) != 2 || hits[0].Message.ID != "m1" {
		t.Fatalf("semantic rank %+v hybrid=%v err=%v", hits, hybrid, err)
	}
	for _, hit := range hits {
		if hit.Message.ThreadID != "a" {
			t.Fatal("cross-conversation search leak")
		}
	}
	i.Embedder = nil
	hits, hybrid, err = i.Search(ctx, "a", "bicycle")
	if err != nil || hybrid || len(hits) != 1 || hits[0].Message.ID != "m2" {
		t.Fatalf("lexical fallback %+v %v %v", hits, hybrid, err)
	}
}

func TestQueryEscaping(t *testing.T) {
	if got := Query(`balloon" OR thread_id:*; DROP TABLE`); got != `"balloon" OR "OR" OR "thread" OR "id" OR "DROP" OR "TABLE"` {
		t.Fatalf("query %q", got)
	}
}

const testModel = "google/embeddinggemma-2"

// embedServer answers one embeddings request and captures what was sent.
func embedServer(t *testing.T, response string) (*HTTPEmbedder, func() map[string]any) {
	t.Helper()
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&sent); err != nil {
			t.Errorf("decode request: %v", err)
		}
		io.WriteString(w, response)
	}))
	t.Cleanup(srv.Close)
	return &HTTPEmbedder{URL: srv.URL + "/v1/embeddings", Model: testModel, Dims: 2, Client: srv.Client()},
		func() map[string]any { return sent }
}

func TestEmbedTaskPrefix(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input Input
		want  string
	}{
		{"query", Input{Text: "when did the balloon launch", Query: true}, "task: search result | query: when did the balloon launch"},
		{"document", Input{Text: "orange balloon"}, "title: none | text: orange balloon"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e, sent := embedServer(t, `{"data":[{"embedding":[3,4]}]}`)
			if _, _, err := e.Embed(t.Context(), tt.input); err != nil {
				t.Fatal(err)
			}
			if got := sent()["input"]; got != tt.want {
				t.Fatalf("embedded %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEmbedReportsServerModel(t *testing.T) {
	e, _ := embedServer(t, `{"model":"embeddinggemma-300M-qat-Q4_0.gguf","data":[{"embedding":[3,4]}]}`)
	_, model, err := e.Embed(t.Context(), Input{Text: "orange balloon"})
	if err != nil {
		t.Fatal(err)
	}
	if model != "embeddinggemma-300M-qat-Q4_0.gguf" {
		t.Fatalf("model %q, want the model the server reported", model)
	}
}

func TestEmbedFallsBackToConfiguredModel(t *testing.T) {
	e, _ := embedServer(t, `{"data":[{"embedding":[3,4]}]}`)
	_, model, err := e.Embed(t.Context(), Input{Text: "orange balloon"})
	if err != nil {
		t.Fatal(err)
	}
	if model != testModel {
		t.Fatalf("model %q, want %q", model, testModel)
	}
}

func TestEmbedRenormalizesTruncatedVector(t *testing.T) {
	e, _ := embedServer(t, `{"data":[{"embedding":[3,4,0,0]}]}`)
	v, _, err := e.Embed(t.Context(), Input{Text: "orange balloon"})
	if err != nil {
		t.Fatal(err)
	}
	want := []float32{0.6, 0.8}
	if len(v) != len(want) {
		t.Fatalf("truncated vector %v, want %d dimensions", v, len(want))
	}
	for n, x := range want {
		if math.Abs(float64(v[n]-x)) > 1e-6 {
			t.Fatalf("truncated vector %v, want the truncated prefix renormalized", v)
		}
	}
}
