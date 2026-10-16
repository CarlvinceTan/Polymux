package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"syscall"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

type sourceBundle struct {
	Version int           `json:"schemaVersion"`
	Source  string        `json:"source"`
	Agents  []sourceAgent `json:"agents"`
	Groups  []sourceGroup `json:"groups"`
}

type sourceAgent struct {
	ID            string    `json:"id"`
	Name          *string   `json:"name,omitempty"`
	Title         *string   `json:"title,omitempty"`
	Instructions  *string   `json:"instructions,omitempty"`
	AvatarShape   *string   `json:"avatarShape,omitempty"`
	AvatarColor   *string   `json:"avatarColor,omitempty"`
	RenderedColor *string   `json:"renderedColor,omitempty"`
	Skills        *[]string `json:"skills,omitempty"`
}

type sourceGroup struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Members []string `json:"memberIds"`
	Lead    *string  `json:"leadId,omitempty"`
}

type sourceChange struct {
	ID     string   `json:"id"`
	Kind   string   `json:"kind"`
	Fields []string `json:"fields"`
}

type sourceReport struct {
	Applied   bool           `json:"applied"`
	Changes   []sourceChange `json:"changes"`
	Unchanged int            `json:"unchanged"`
	Missing   []sourceChange `json:"missing"`
	Excluded  []string       `json:"excluded"`
}

var sourceID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)
var skillID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

func runMigration(ctx context.Context, dir string, input io.Reader, output io.Writer, apply bool) (err error) {
	dir, err = filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve migration directory: %w", err)
	}
	data, err := io.ReadAll(io.LimitReader(input, (8<<20)+1))
	if err != nil || len(data) > 8<<20 || credentials.Match(data) {
		return errors.New("migration input rejected")
	}
	var source sourceBundle
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&source); err != nil {
		return errors.New("invalid migration input")
	}
	if decoder.Decode(new(any)) != io.EOF || source.Version != 1 || source.Source != "grokbot" {
		return errors.New("invalid migration source or version")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return fmt.Errorf("open migration directory: %w", err)
	}
	defer func() { err = errors.Join(err, root.Close()) }()
	flags := os.O_RDONLY
	if apply {
		flags = os.O_RDWR
	}
	lock, err := root.OpenFile(".server.lock", flags, 0)
	if err != nil {
		return fmt.Errorf("open server lock: %w", err)
	}
	defer func() { err = errors.Join(err, lock.Close()) }()
	// Read-only WAL indexes avoid writing read marks into the live source.
	mode := "ro&_query_only=on&readonly_shm=1"
	path := filepath.Join(dir, "polymux.db")
	if apply {
		if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
			return errors.New("migration requires a stopped server")
		}
		mode = "rw"
	} else {
		err = syscall.Flock(int(lock.Fd()), syscall.LOCK_SH|syscall.LOCK_NB)
		if err == nil {
			// A stopped server's WAL may lack its index; recover only a private copy.
			var temp string
			temp, err = os.MkdirTemp("", "polymux-preview-")
			if err != nil {
				return fmt.Errorf("create preview snapshot: %w", err)
			}
			defer func() { err = errors.Join(err, os.RemoveAll(temp)) }()
			for _, name := range []string{"polymux.db", "polymux.db-wal"} {
				if err := copyPreview(root, temp, name); err != nil {
					return err
				}
			}
			path, mode = filepath.Join(temp, "polymux.db"), "rw&_query_only=on"
		} else if !errors.Is(err, syscall.EWOULDBLOCK) {
			return fmt.Errorf("lock preview snapshot: %w", err)
		}
	}
	db, err := sql.Open("sqlite3", "file:"+url.PathEscape(path)+"?mode="+mode+"&_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return fmt.Errorf("open migration database: %w", err)
	}
	defer func() { err = errors.Join(err, db.Close()) }()
	db.SetMaxOpenConns(1)
	report, err := migrateSource(ctx, db, root, dir, source, apply)
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(report)
}

func copyPreview(root *os.Root, dir, name string) (err error) {
	file, err := root.Open(name)
	if errors.Is(err, os.ErrNotExist) && name == "polymux.db-wal" {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read preview database: %w", err)
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	copy, err := os.OpenFile(filepath.Join(dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create preview database: %w", err)
	}
	defer func() { err = errors.Join(err, copy.Close()) }()
	_, err = io.Copy(copy, file)
	return err
}

func migrateSource(ctx context.Context, db *sql.DB, root *os.Root, dir string, source sourceBundle, apply bool) (sourceReport, error) {
	report := sourceReport{Applied: apply, Changes: []sourceChange{}, Missing: []sourceChange{},
		Excluded: []string{"sidebar", "history", "memory", "routines", "mcp"}}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: !apply})
	if err != nil {
		return report, fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback()
	seen := map[string]bool{}
	pending := map[string]bool{}
	for _, a := range source.Agents {
		if !sourceID.MatchString(a.ID) || seen[a.ID] {
			return report, errors.New("invalid or duplicate source id")
		}
		seen[a.ID] = true
		fields, missing, err := migrateAgent(ctx, tx, root, dir, a, apply)
		if err != nil {
			return report, fmt.Errorf("migrate agent: %w", err)
		}
		report.record("agent", a.ID, fields, missing)
		pending[a.ID] = true
	}
	for _, g := range source.Groups {
		if !sourceID.MatchString(g.ID) || seen[g.ID] {
			return report, errors.New("invalid or duplicate source id")
		}
		seen[g.ID] = true
		fields, err := migrateGroup(ctx, tx, g, pending, apply)
		if err != nil {
			return report, fmt.Errorf("migrate group: %w", err)
		}
		report.record("group", g.ID, fields, nil)
	}
	if apply {
		if err := tx.Commit(); err != nil {
			return report, fmt.Errorf("commit migration: %w", err)
		}
	}
	return report, nil
}

func (r *sourceReport) record(kind, id string, fields, missing []string) {
	if len(fields) == 0 {
		r.Unchanged++
	} else {
		r.Changes = append(r.Changes, sourceChange{id, kind, fields})
	}
	if len(missing) > 0 {
		r.Missing = append(r.Missing, sourceChange{id, kind, missing})
	}
}

type sourceObject map[string]any

func migrateAgent(ctx context.Context, tx *sql.Tx, root *os.Root, dir string, source sourceAgent, apply bool) ([]string, []string, error) {
	var agentJSON, definition string
	err := tx.QueryRowContext(ctx, `SELECT a.data,d.data FROM agents a JOIN agent_definitions d ON d.agent_id=a.id WHERE a.id=?`, source.ID).Scan(&agentJSON, &definition)
	added := errors.Is(err, sql.ErrNoRows)
	if err != nil && !added {
		return nil, nil, err
	}
	a, d := sourceObject{}, sourceObject{}
	if !added {
		a, err = readObject(agentJSON)
		if err != nil {
			return nil, nil, err
		}
		d, err = readObject(definition)
		if err != nil {
			return nil, nil, err
		}
	} else {
		var collisions int
		if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM agents WHERE id=?)+(SELECT count(*) FROM deleted_agents WHERE id=?)+(SELECT count(*) FROM threads WHERE id=?)`, source.ID, source.ID, source.ID).Scan(&collisions); err != nil {
			return nil, nil, err
		}
		if collisions > 0 {
			return nil, nil, errors.New("source id conflicts with existing data")
		}
		a = sourceObject{"id": source.ID, "model": "", "active": false}
		d = sourceObject{"agent": sourceObject{}, "tools": []any{}}
	}
	profile, ok := d["agent"].(map[string]any)
	if added {
		profile = sourceObject{"id": source.ID, "model": "", "active": false}
	} else if !ok || a["id"] != source.ID || profile["id"] != source.ID {
		return nil, nil, errors.New("stored agent identity mismatch")
	}
	fields, missing := []string{}, []string{}
	for _, f := range []struct {
		name, key string
		value     *string
	}{{"name", "name", source.Name}, {"title", "role", source.Title}, {"instructions", "prompt", source.Instructions}} {
		if f.value == nil {
			missing = append(missing, f.name)
			continue
		}
		if f.name == "name" && strings.TrimSpace(*f.value) == "" {
			return nil, nil, errors.New("empty source name")
		}
		if f.key == "prompt" {
			if d[f.key] != *f.value {
				d[f.key] = *f.value
				fields = append(fields, f.name)
			}
		} else if a[f.key] != *f.value || profile[f.key] != *f.value {
			a[f.key], profile[f.key] = *f.value, *f.value
			fields = append(fields, f.name)
		}
	}
	if source.AvatarShape == nil && source.AvatarColor == nil {
		missing = append(missing, "avatar")
	} else {
		if source.AvatarShape == nil || source.AvatarColor == nil ||
			!slices.Contains([]string{"blob", "wedge", "square", "hex", "cloud"}, *source.AvatarShape) {
			return nil, nil, errors.New("source avatar requires a known explicit shape and color")
		}
		color := *source.AvatarColor
		if color == "" || color == "-" {
			if source.RenderedColor == nil {
				return nil, nil, errors.New("default source avatar requires its verified rendered color")
			}
			color = *source.RenderedColor
		} else if source.RenderedColor != nil && *source.RenderedColor != color {
			return nil, nil, errors.New("rendered avatar color conflicts with source")
		}
		colors := map[string]string{"black": "encre", "brown": "brun", "red": "rouge", "orange": "orange", "yellow": "ambre",
			"green": "vert", "cyan": "turquoise", "blue": "bleu", "violet": "violet", "magenta": "rose", "gray": "gris"}
		if colors[color] == "" {
			return nil, nil, errors.New("unknown rendered avatar color")
		}
		mapped := contract.GrokBotAvatarDesign(*source.AvatarShape, "black")
		mapped.Color = colors[color]
		original := map[string]any{"shape": *source.AvatarShape, "color": *source.AvatarColor, "renderedColor": color}
		if !reflect.DeepEqual(d["grokbotAvatar"], original) {
			d["grokbotAvatar"] = original
			fields = append(fields, "avatarSource")
		}
		avatar, _ := a["avatar"].(map[string]any)
		if avatar == nil {
			data, err := json.Marshal(mapped)
			if err != nil {
				return nil, nil, err
			}
			avatar, err = readObject(string(data))
			if err != nil {
				return nil, nil, err
			}
		}
		changed := avatar["shape"] != mapped.Shape || avatar["color"] != mapped.Color || !reflect.DeepEqual(profile["avatar"], avatar)
		avatar["shape"], avatar["color"] = mapped.Shape, mapped.Color
		if changed {
			fields = append(fields, "avatar")
		}
		a["avatar"], profile["avatar"] = avatar, avatar
	}
	if source.Skills == nil {
		missing = append(missing, "skills")
	} else {
		paths, seen := []any{}, map[string]bool{}
		for _, name := range *source.Skills {
			if !skillID.MatchString(name) || seen[name] {
				return nil, nil, errors.New("invalid or duplicate source skill")
			}
			seen[name] = true
			path := filepath.Join("skills", name, "SKILL.md")
			info, err := root.Stat(path)
			if err != nil || !info.Mode().IsRegular() {
				return nil, nil, errors.New("source skill is unavailable locally")
			}
			paths = append(paths, filepath.Join(dir, path))
		}
		if !reflect.DeepEqual(d["skills"], paths) {
			d["skills"] = paths
			fields = append(fields, "skills")
		}
	}
	if added && len(missing) > 0 {
		return nil, nil, errors.New("new source agent requires a complete profile")
	}
	d["agent"] = profile
	if !apply || len(fields) == 0 {
		return fields, missing, nil
	}
	data, err := json.Marshal(a)
	if err != nil {
		return nil, nil, err
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agents(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, source.ID, string(data)); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_definitions(agent_id,data) VALUES(?,?) ON CONFLICT(agent_id) DO UPDATE SET data=excluded.data`, source.ID, string(raw)); err != nil {
		return nil, nil, err
	}
	if added {
		if _, err := tx.ExecContext(ctx, `INSERT INTO threads(id,agent_id) VALUES(?,?)`, source.ID, source.ID); err != nil {
			return nil, nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO thread_members(thread_id,agent_id,position) VALUES(?,?,0)`, source.ID, source.ID); err != nil {
			return nil, nil, err
		}
	}
	return fields, missing, nil
}

func readObject(data string) (sourceObject, error) {
	decoder := json.NewDecoder(strings.NewReader(data))
	decoder.UseNumber()
	var object sourceObject
	err := decoder.Decode(&object)
	return object, err
}

func migrateGroup(ctx context.Context, tx *sql.Tx, source sourceGroup, pending map[string]bool, apply bool) ([]string, error) {
	if strings.TrimSpace(source.Name) == "" || len(source.Members) < 2 || len(source.Members) > 16 {
		return nil, errors.New("source group requires a name and explicit membership")
	}
	var primary, title, lead string
	err := tx.QueryRowContext(ctx, `SELECT agent_id,title,lead_agent_id FROM threads WHERE id=?`, source.ID).Scan(&primary, &title, &lead)
	added := errors.Is(err, sql.ErrNoRows)
	if err != nil && !added {
		return nil, err
	}
	if primary == source.ID {
		return nil, errors.New("source group conflicts with a direct conversation")
	}
	seen := map[string]bool{}
	for _, id := range source.Members {
		var exists int
		if !sourceID.MatchString(id) || seen[id] {
			return nil, errors.New("invalid or duplicate source member")
		}
		seen[id] = true
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM agents WHERE id=?`, id).Scan(&exists); err != nil {
			return nil, err
		}
		if exists != 1 && !pending[id] {
			return nil, errors.New("source member is not imported")
		}
	}
	if source.Lead != nil {
		lead = *source.Lead
	}
	if !seen[lead] {
		return nil, errors.New("source group requires an explicit member as lead")
	}
	rows, err := tx.QueryContext(ctx, `SELECT agent_id FROM thread_members WHERE thread_id=? ORDER BY position`, source.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	members := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		members = append(members, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	fields := []string{}
	if title != source.Name {
		fields = append(fields, "name")
	}
	if !slices.Equal(members, source.Members) || primary != source.Members[0] {
		fields = append(fields, "members")
	}
	if source.Lead != nil {
		var old string
		if !added {
			if err := tx.QueryRowContext(ctx, `SELECT lead_agent_id FROM threads WHERE id=?`, source.ID).Scan(&old); err != nil {
				return nil, err
			}
		}
		if old != lead {
			fields = append(fields, "lead")
		}
	}
	if !apply || len(fields) == 0 {
		return fields, nil
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO threads(id,agent_id,title,lead_agent_id) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET agent_id=excluded.agent_id,title=excluded.title,lead_agent_id=excluded.lead_agent_id`, source.ID, source.Members[0], source.Name, lead); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM thread_members WHERE thread_id=?`, source.ID); err != nil {
		return nil, err
	}
	for position, id := range source.Members {
		if _, err := tx.ExecContext(ctx, `INSERT INTO thread_members(thread_id,agent_id,position) VALUES(?,?,?)`, source.ID, id, position); err != nil {
			return nil, err
		}
	}
	return fields, nil
}
