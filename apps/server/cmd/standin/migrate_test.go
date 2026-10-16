package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

func migrationFixture(t *testing.T) (string, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	s, err := store.Open(t.Context(), filepath.Join(dir, "polymux.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	for _, id := range []string{"a", "b", "c", "lead"} {
		a := contract.Agent{ID: id, Name: "Local " + id, Role: "Local role", Model: "chosen/model",
			Avatar: &contract.AvatarDesign{Shape: "cercle", Color: "encre", Animates: false}}
		definition := map[string]any{"agent": a, "prompt": "Local instructions", "skills": []string{},
			"workspace": "/local/repo", "tools": []string{"existing_tool"}, "mcp": []any{map[string]any{"name": "existing"}},
			"futureRuntimeSetting": "preserve", "futureRuntimeNumber": json.Number("9007199254740993")}
		data, err := json.Marshal(definition)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SaveDefinition(t.Context(), a, data); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.CreateThread(t.Context(), "group", contract.CreateThreadRequest{AgentIDs: []string{"a", "b"}, Title: new("Local group")}); err != nil {
		t.Fatal(err)
	}
	for _, thread := range []string{"a", "group"} {
		msg := contract.Message{ID: "live-" + thread, ThreadID: thread, Role: "user", Status: "done", Parts: []contract.Part{{Kind: "text", Text: new("Live message")}}, CreatedAt: store.Now()}
		if _, err := s.Append(t.Context(), contract.Event{ConversationID: thread, Type: "message.done", MessageID: &msg.ID}, &msg); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.DB.ExecContext(t.Context(), `UPDATE threads SET last_read_seq=7 WHERE id='group'`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".server.lock", "agents.json", "model.json", "memory/preserved", "skills/source-skill/SKILL.md"} {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("Existing local data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir, s
}

func sourceFixture() sourceBundle {
	return sourceBundle{Version: 1, Source: "grokbot", Agents: []sourceAgent{{ID: "a", Name: new("Source name"),
		Title: new("Source title"), Instructions: new("Original source instructions"), AvatarShape: new("hex"), AvatarColor: new("orange"),
		Skills: new([]string{"source-skill"})}}, Groups: []sourceGroup{{ID: "group", Name: "Source group", Members: []string{"b", "c", "a"}, Lead: new("b")}}}
}

func migrateFixture(t *testing.T, dir string, source sourceBundle, apply bool) sourceReport {
	t.Helper()
	data, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runMigration(t.Context(), dir, bytes.NewReader(data), &output, apply); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "Original source instructions") || strings.Contains(output.String(), "Source name") {
		t.Fatal("migration report exposed source content")
	}
	var report sourceReport
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	return report
}

func diskState(t *testing.T, dir string) map[string][32]byte {
	t.Helper()
	state := map[string][32]byte{}
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		state[strings.TrimPrefix(path, dir)] = sha256.Sum256(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestMigrationPreserves(t *testing.T) {
	dir, s := migrationFixture(t)
	ctx := t.Context()
	var lead, messages, events string
	for _, item := range []struct {
		query string
		value *string
	}{{`SELECT data FROM agent_definitions WHERE agent_id='lead'`, &lead},
		{`SELECT group_concat(data) FROM messages ORDER BY id`, &messages},
		{`SELECT group_concat(data) FROM events ORDER BY thread_id,seq`, &events}} {
		if err := s.DB.QueryRowContext(ctx, item.query).Scan(item.value); err != nil {
			t.Fatal(err)
		}
	}
	before := diskState(t, dir)
	report := migrateFixture(t, dir, sourceFixture(), false)
	if report.Applied || len(report.Changes) != 2 || !reflect.DeepEqual(before, diskState(t, dir)) {
		t.Fatal("preview changed source files or missed changes")
	}
	report = migrateFixture(t, dir, sourceFixture(), true)
	if !report.Applied || len(report.Changes) != 2 {
		t.Fatal("migration missed profile or membership changes")
	}
	var data string
	if err := s.DB.QueryRowContext(ctx, `SELECT data FROM agent_definitions WHERE agent_id='a'`).Scan(&data); err != nil {
		t.Fatal(err)
	}
	d, err := readObject(data)
	if err != nil {
		t.Fatal(err)
	}
	a := d["agent"].(map[string]any)
	avatar := a["avatar"].(map[string]any)
	if a["model"] != "chosen/model" || a["name"] != "Source name" || d["prompt"] != "Original source instructions" ||
		d["workspace"] != "/local/repo" || d["futureRuntimeSetting"] != "preserve" || len(d["mcp"].([]any)) != 1 ||
		d["futureRuntimeNumber"] != json.Number("9007199254740993") ||
		avatar["shape"] != "hexagone" || avatar["color"] != "orange" || avatar["animates"] != false {
		t.Fatal("migration lost runtime settings or missed source fields")
	}
	for _, item := range []struct{ query, want string }{
		{`SELECT data FROM agent_definitions WHERE agent_id='lead'`, lead},
		{`SELECT group_concat(data) FROM messages ORDER BY id`, messages},
		{`SELECT group_concat(data) FROM events ORDER BY thread_id,seq`, events},
		{`SELECT group_concat(agent_id) FROM (SELECT agent_id FROM thread_members WHERE thread_id='group' ORDER BY position)`, "b,c,a"},
		{`SELECT lead_agent_id FROM threads WHERE id='group'`, "b"},
		{`SELECT last_read_seq FROM threads WHERE id='group'`, "7"},
		{`SELECT count(*) FROM agents`, "4"}, {`SELECT count(*) FROM jobs`, "0"},
	} {
		if err := s.DB.QueryRowContext(ctx, item.query).Scan(&data); err != nil || data != item.want {
			t.Fatal("migration changed preserved data or membership incorrectly", err)
		}
	}
	after := diskState(t, dir)
	for _, name := range []string{"/agents.json", "/model.json", "/memory/preserved", "/skills/source-skill/SKILL.md"} {
		if before[name] != after[name] {
			t.Fatal("migration rewrote a preserved file")
		}
	}
	report = migrateFixture(t, dir, sourceFixture(), true)
	if len(report.Changes) != 0 || report.Unchanged != 2 {
		t.Fatal("repeated migration was not idempotent")
	}
}

func TestMigrationMissing(t *testing.T) {
	dir, s := migrationFixture(t)
	var before string
	if err := s.DB.QueryRowContext(t.Context(), `SELECT data FROM agent_definitions WHERE agent_id='a'`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	report := migrateFixture(t, dir, sourceBundle{Version: 1, Source: "grokbot", Agents: []sourceAgent{{ID: "a"}}}, true)
	var after string
	if err := s.DB.QueryRowContext(t.Context(), `SELECT data FROM agent_definitions WHERE agent_id='a'`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after || len(report.Changes) != 0 || len(report.Missing) != 1 || len(report.Missing[0].Fields) != 5 {
		t.Fatal("missing source fields were inferred or cleared")
	}
}

func TestAvatarDefault(t *testing.T) {
	for color, native := range map[string]string{"brown": "brun", "red": "rouge", "gray": "gris", "green": "vert"} {
		t.Run(color, func(t *testing.T) {
			dir, s := migrationFixture(t)
			source := sourceFixture()
			source.Agents[0].AvatarColor = new("")
			source.Agents[0].RenderedColor = new(color)
			migrateFixture(t, dir, source, true)
			var data string
			if err := s.DB.QueryRowContext(t.Context(), `SELECT data FROM agent_definitions WHERE agent_id='a'`).Scan(&data); err != nil {
				t.Fatal(err)
			}
			d, err := readObject(data)
			if err != nil {
				t.Fatal(err)
			}
			avatar := d["agent"].(map[string]any)["avatar"].(map[string]any)
			original := d["grokbotAvatar"].(map[string]any)
			if avatar["color"] != native || original["color"] != "" || original["renderedColor"] != color {
				t.Fatal("rendered color or original default token was lost")
			}
			if report := migrateFixture(t, dir, source, true); len(report.Changes) != 0 {
				t.Fatal("verified default color migration was not idempotent")
			}
		})
	}
}

func TestMigrationRejects(t *testing.T) {
	for _, kind := range []string{"missing-members", "unknown-avatar", "missing-color", "duplicate-id", "unknown-member", "outside-skill", "partial-new-agent"} {
		t.Run(kind, func(t *testing.T) {
			dir, s := migrationFixture(t)
			source := sourceFixture()
			switch kind {
			case "missing-members":
				source.Groups[0].Members = nil
			case "unknown-avatar":
				source.Agents[0].AvatarShape = new("unknown")
			case "missing-color":
				source.Agents[0].AvatarColor = new("")
			case "duplicate-id":
				source.Groups[0].ID = "a"
			case "unknown-member":
				source.Groups[0].Members = []string{"b", "missing"}
			case "outside-skill":
				source.Agents[0].Skills = new([]string{"../outside"})
			case "partial-new-agent":
				source.Agents = append(source.Agents, sourceAgent{ID: "new"})
			}
			var before, after string
			if err := s.DB.QueryRowContext(t.Context(), `SELECT group_concat(data) FROM agent_definitions`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			data, err := json.Marshal(source)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err := runMigration(t.Context(), dir, bytes.NewReader(data), &output, true); err == nil || output.Len() != 0 {
				t.Fatal("invalid source was accepted or exposed partial output")
			}
			if err := s.DB.QueryRowContext(t.Context(), `SELECT group_concat(data) FROM agent_definitions`).Scan(&after); err != nil || before != after {
				t.Fatal("failed migration left a partial update", err)
			}
		})
	}
}

func TestMigrationCreates(t *testing.T) {
	dir, s := migrationFixture(t)
	source := sourceFixture()
	source.Agents[0].ID = "new-agent"
	source.Groups = []sourceGroup{{ID: "new-group", Name: "Imported group", Members: []string{"new-agent", "a"}, Lead: new("new-agent")}}
	if report := migrateFixture(t, dir, source, false); len(report.Changes) != 2 {
		t.Fatal("preview did not include new source records")
	}
	migrateFixture(t, dir, source, true)
	if report := migrateFixture(t, dir, source, true); len(report.Changes) != 0 {
		t.Fatal("source ids created duplicate records")
	}
	var agents, threads, jobs int
	if err := s.DB.QueryRowContext(t.Context(), `SELECT (SELECT count(*) FROM agents),(SELECT count(*) FROM threads),(SELECT count(*) FROM jobs)`).Scan(&agents, &threads, &jobs); err != nil {
		t.Fatal(err)
	}
	if agents != 5 || threads != 7 || jobs != 0 {
		t.Fatal("migration created duplicate data or scheduled historical work")
	}
}

func TestMigrationLocked(t *testing.T) {
	dir, _ := migrationFixture(t)
	lock, err := os.OpenFile(filepath.Join(dir, ".server.lock"), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(sourceFixture())
	if err != nil {
		t.Fatal(err)
	}
	before := diskState(t, dir)
	if err := runMigration(t.Context(), dir, bytes.NewReader(data), new(bytes.Buffer), true); err == nil {
		t.Fatal("migration wrote while the server held its lock")
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestPreviewProcess$")
	cmd.Env = append(os.Environ(), "POLYMUX_PREVIEW_TEST="+dir)
	output, err := cmd.CombinedOutput()
	if err != nil || !reflect.DeepEqual(before, diskState(t, dir)) {
		t.Fatal("live preview failed or modified database/WAL/index files", err, string(output))
	}
}

func TestPreviewProcess(t *testing.T) {
	dir := os.Getenv("POLYMUX_PREVIEW_TEST")
	if dir == "" {
		return
	}
	migrateFixture(t, dir, sourceFixture(), false)
	os.Exit(0)
}

func TestPreviewRecovery(t *testing.T) {
	dir, _ := migrationFixture(t)
	snapshot := t.TempDir()
	for _, name := range []string{".server.lock", "polymux.db", "polymux.db-wal"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(snapshot, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	before := diskState(t, snapshot)
	source := sourceBundle{Version: 1, Source: "grokbot", Agents: []sourceAgent{{ID: "a", Name: new("Source name")}}}
	if report := migrateFixture(t, snapshot, source, false); len(report.Changes) != 1 {
		t.Fatal("preview missed committed WAL data")
	}
	if !reflect.DeepEqual(before, diskState(t, snapshot)) {
		t.Fatal("preview recovered or created an index in the source directory")
	}
}
