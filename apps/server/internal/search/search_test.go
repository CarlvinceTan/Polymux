package search

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CarlvinceTan/luce/apps/server/internal/contract"
	"github.com/CarlvinceTan/luce/apps/server/internal/store"
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
