//go:build !release

package fixture

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

func TestSeedMatchesManifest(t *testing.T) {
	dir := t.TempDir()
	if err := Seed(dir); err != nil {
		t.Fatal(err)
	}
	if err := Seed(dir); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(t.Context(), filepath.Join(dir, "polymux.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	wantThreads := []string{"grp-empty", "grp-trip", "t-activity", "t-approval", "t-aria", "t-chief", "t-fern", "t-long", "t-media", "t-milo", "t-nova", "t-stream"}
	wantAgents := []string{"t-approval", "t-aria", "t-chief", "t-fern", "t-milo", "t-nova"}
	if got := ids(t, db, `SELECT id FROM threads ORDER BY id`); !slices.Equal(got, wantThreads) {
		t.Fatalf("threads %v", got)
	}
	if got := ids(t, db, `SELECT id FROM agents ORDER BY id`); !slices.Equal(got, wantAgents) {
		t.Fatalf("agents %v", got)
	}
	checks := []struct {
		q string
		n int
	}{
		{`SELECT count(*) FROM threads WHERE id=agent_id`, 6},
		{`SELECT count(*) FROM threads WHERE id='grp-empty' AND id!=agent_id`, 1},
		{`SELECT count(*) FROM messages WHERE thread_id='grp-empty'`, 0},
		{`SELECT count(*) FROM messages WHERE thread_id='t-long'`, 500},
		{`SELECT count(*) FROM messages WHERE thread_id='t-chief'`, 2},
		{`SELECT count(*) FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.thread_id='t-aria' AND m.role='assistant' AND m.seq>t.last_read_seq`, 3},
		{`SELECT count(*) FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.thread_id='t-milo' AND m.role='assistant' AND m.seq>t.last_read_seq`, 1},
		{`SELECT count(*) FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.thread_id='t-nova' AND m.role='assistant' AND m.seq>t.last_read_seq`, 12},
		{`SELECT count(*) FROM messages m JOIN threads t ON t.id=m.thread_id WHERE m.thread_id='t-chief' AND m.role='assistant' AND m.seq>t.last_read_seq`, 0},
		{`SELECT count(*) FROM messages WHERE status='streaming'`, 1},
		{`SELECT count(*) FROM messages WHERE id='focus:t-approval' AND json_extract(data,'$.parts[0].kind')='choice' AND json_type(data,'$.parts[0].answerID') IS NULL`, 1},
		{`SELECT count(DISTINCT json_extract(data,'$.agentID')) FROM messages WHERE thread_id='grp-trip'`, 3},
		{`SELECT count(*) FROM messages WHERE thread_id='grp-trip' AND json_extract(data,'$.replyToID') IS NOT NULL`, 2},
		{`SELECT count(*) FROM messages WHERE instr(data,'polymux verify lighthouse')>0`, 1},
		{`SELECT count(*) FROM attachments`, 1},
		{`SELECT count(*) FROM runs WHERE id='run-activity' AND instr(data,'"name":"read"')>0`, 1},
		{`SELECT count(*) FROM routines`, 1},
		{`SELECT count(*) FROM runs WHERE json_extract(data,'$.routineID') IS NOT NULL`, 5},
		{`SELECT count(*) FROM runs WHERE status='failed'`, 1},
		{`SELECT count(*) FROM proactivity WHERE agent_id='t-chief' AND json_extract(data,'$.enabled')=1`, 1},
		{`SELECT count(*) FROM proactivity WHERE agent_id!='t-chief'`, 0},
	}
	for _, check := range checks {
		if got := scalar(t, db, check.q); got != check.n {
			t.Fatalf("%s: got %d want %d", check.q, got, check.n)
		}
	}
	var first, second string
	if err := db.DB.QueryRowContext(t.Context(), `SELECT json_extract(data,'$.createdAt') FROM messages WHERE id='m-trip-2'`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err := db.DB.QueryRowContext(t.Context(), `SELECT json_extract(data,'$.createdAt') FROM messages WHERE id='m-trip-3'`).Scan(&second); err != nil {
		t.Fatal(err)
	}
	left, err := time.Parse(time.RFC3339, first)
	if err != nil {
		t.Fatal(err)
	}
	right, err := time.Parse(time.RFC3339, second)
	if err != nil {
		t.Fatal(err)
	}
	if right.Sub(left) != 7*time.Minute {
		t.Fatalf("trip gap %s", right.Sub(left))
	}
	raw, err := os.ReadFile(filepath.Join(dir, marker))
	if err != nil {
		t.Fatal(err)
	}
	var pinned struct {
		Pinned []string `json:"pinned"`
	}
	if err := json.Unmarshal(raw, &pinned); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(pinned.Pinned, []string{"t-chief"}) {
		t.Fatalf("pinned %v", pinned.Pinned)
	}
	if scalar(t, db, `SELECT count(*) FROM messages`) != 500+2+3+1+12+1+1+3+1+1+1 {
		t.Fatal("re-seed duplicated messages")
	}
}

func TestSeedRefuses(t *testing.T) {
	busy := t.TempDir()
	if err := os.WriteFile(filepath.Join(busy, "real.txt"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(home, "Library", "Application Support", "Polymux", "verify-fixture-refusal")
	t.Cleanup(func() { os.RemoveAll(real) })
	for _, dir := range []string{busy, real} {
		err := Seed(dir)
		if !errors.Is(err, ErrRefused) {
			t.Fatalf("Seed(%s) = %v", dir, err)
		}
	}
	if _, err := os.Stat(real); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("created a path under Application Support")
	}
	if _, err := os.Stat(filepath.Join(busy, "polymux.db")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("wrote into a non-empty data dir")
	}
}

func ids(t *testing.T, db *store.Store, query string) []string {
	t.Helper()
	rows, err := db.DB.QueryContext(t.Context(), query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func scalar(t *testing.T, db *store.Store, query string) int {
	t.Helper()
	var n int
	if err := db.DB.QueryRowContext(t.Context(), query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
