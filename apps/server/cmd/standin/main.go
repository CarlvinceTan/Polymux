package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"syscall"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/memory"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
)

type fact struct {
	Owner    string          `json:"owner"`
	Scope    string          `json:"scope"`
	Document memory.Document `json:"document"`
}
type group struct {
	ID      string                       `json:"id"`
	Request contract.CreateThreadRequest `json:"request"`
}
type bundle struct {
	Definitions []agentruntime.Definition `json:"definitions"`
	Memory      []fact                    `json:"memory"`
	Groups      []group                   `json:"groups"`
	History     []contract.Message        `json:"history"`
	Routines    []contract.Routine        `json:"routines"`
}

var credentials = regexp.MustCompile(`-----BEGIN .*PRIVATE KEY|\b(sk-|ghp_|github_pat_|xox[baprs]-|ntn_|secret_)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?i)"[A-Z_]*(PASSWORD|TOKEN|API_KEY)"\s*:\s*"[^"]+"`)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "standin operation failed; inspect input structure and data ownership")
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 3 {
		return errors.New("usage: standin import|export DATA")
	}
	ctx := context.Background()
	dir := os.Args[2]
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(dir, ".server.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return err
	}
	s, err := store.Open(ctx, filepath.Join(dir, "polymux.db"))
	if err != nil {
		return err
	}
	defer s.Close()
	m := memory.New(filepath.Join(dir, "memory"))
	defer m.Close()
	if os.Args[1] == "export" {
		raw, err := s.Definitions(ctx)
		if err != nil {
			return err
		}
		out := bundle{}
		for _, r := range raw {
			var d agentruntime.Definition
			if err := json.Unmarshal(r, &d); err != nil {
				return err
			}
			out.Definitions = append(out.Definitions, d)
			docs, err := m.List(ctx, d.Agent.ID, d.Agent.ID)
			if err != nil {
				return err
			}
			for _, doc := range docs {
				out.Memory = append(out.Memory, fact{d.Agent.ID, d.Agent.ID, doc})
			}
			routines, err := s.Routines(ctx, d.Agent.ID)
			if err != nil {
				return err
			}
			out.Routines = append(out.Routines, routines...)
		}
		threads, err := s.Threads(ctx)
		if err != nil {
			return err
		}
		for _, t := range threads {
			if t.ID == t.AgentID {
				continue
			}
			for _, id := range t.AgentIDs {
				docs, err := m.List(ctx, id, t.ID)
				if err != nil {
					return err
				}
				for _, doc := range docs {
					out.Memory = append(out.Memory, fact{id, t.ID, doc})
				}
			}
		}
		data, err := json.Marshal(out)
		if err != nil {
			return err
		}
		if credentials.Match(data) {
			return errors.New("credential export rejected")
		}
		_, err = os.Stdout.Write(append(data, '\n'))
		return err
	}
	if os.Args[1] != "import" {
		return errors.New("unknown operation")
	}
	var b bundle
	if err := json.NewDecoder(os.Stdin).Decode(&b); err != nil {
		return err
	}
	for _, d := range b.Definitions {
		raw, err := json.Marshal(d)
		if err != nil {
			return err
		}
		if err := s.SaveDefinition(ctx, d.Agent, raw); err != nil {
			return err
		}
	}
	for _, g := range b.Groups {
		if _, err := s.Thread(ctx, g.ID); err == nil {
			continue
		}
		if _, err := s.CreateThread(ctx, g.ID, g.Request); err != nil {
			return err
		}
	}
	for _, f := range b.Memory {
		docs, err := m.List(ctx, f.Owner, f.Scope)
		if err != nil {
			return err
		}
		exists := false
		for _, old := range docs {
			if old.Name == f.Document.Name {
				exists = true
				break
			}
		}
		if !exists {
			if _, err := m.Save(ctx, f.Owner, f.Scope, f.Document); err != nil {
				return err
			}
		}
	}
	for _, msg := range b.History {
		var n int
		if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM messages WHERE id=?", msg.ID).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if _, err := s.Append(ctx, contract.Event{ConversationID: msg.ThreadID, Type: "message.done", MessageID: &msg.ID}, &msg); err != nil {
			return err
		}
	}
	for _, r := range b.Routines {
		// Disabled imports are retained for review without scheduling them.
		if r.Status == "disabled" {
			raw, err := json.Marshal(r)
			if err != nil {
				return err
			}
			if _, err := s.DB.ExecContext(ctx, "INSERT OR IGNORE INTO routines(id,agent_id,next_at,data) VALUES(?,?,NULL,?)", r.ID, r.AgentID, string(raw)); err != nil {
				return err
			}
			continue
		}
		if _, err := s.CreateRoutine(ctx, r); err != nil {
			return err
		}
	}
	fmt.Printf("Imported %d agents, %d groups, %d memory documents, %d history messages, %d routines\n", len(b.Definitions), len(b.Groups), len(b.Memory), len(b.History), len(b.Routines))
	return nil
}
