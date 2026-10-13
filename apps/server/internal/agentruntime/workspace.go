package agentruntime

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// RepoError explains a workspace repository that could not be prepared. Its
// message is shown in the conversation, so a broken checkout never reads as a
// generic reply failure.
type RepoError struct {
	Err error
}

func (e *RepoError) Error() string { return "Can't open repo: " + e.Err.Error() }
func (e *RepoError) Unwrap() error { return e.Err }

// Worktrees prepares the per-conversation checkouts of agent workspaces. Each
// conversation gets its own worktree under one directory, and an existing
// checkout is reused, so a session reopened later keeps its files.
type Worktrees struct {
	dir string
	mu  sync.Mutex
}

func NewWorktrees(dir string) *Worktrees { return &Worktrees{dir: dir} }

// Path is the checkout a conversation uses under this manager's directory.
func (w *Worktrees) Path(thread string) string { return filepath.Join(w.dir, thread) }

// WorkspaceThread names the conversation a definition's checkout belongs to:
// the group thread when it has one, otherwise the agent's direct chat.
func WorkspaceThread(d Definition) string {
	if d.Scope != "" {
		return d.Scope
	}
	return d.Agent.ID
}

// Ensure returns the conversation's checkout of repo. The first call fetches
// origin and adds a worktree on the conversation's branch from origin/main;
// later calls reuse the checkout that is already there.
func (w *Worktrees) Ensure(ctx context.Context, repo, thread string) (string, error) {
	if err := checkThread(thread); err != nil {
		return "", err
	}
	path := w.Path(thread)
	w.mu.Lock()
	defer w.mu.Unlock()
	if info, err := os.Stat(path); err == nil {
		if info.IsDir() {
			return path, nil
		}
		return "", &RepoError{Err: fmt.Errorf("%s is not a directory", path)}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", &RepoError{Err: err}
	}
	if err := os.MkdirAll(w.dir, 0700); err != nil {
		return "", &RepoError{Err: err}
	}
	if err := git(ctx, repo, "fetch", "origin"); err != nil {
		return "", err
	}
	branch := branchName(thread)
	if branchExists(ctx, repo, branch) {
		// A checkout removed by hand leaves its branch behind; reuse it.
		if err := git(ctx, repo, "worktree", "add", path, branch); err != nil {
			return "", err
		}
		return path, nil
	}
	if err := git(ctx, repo, "worktree", "add", path, "-b", branch, "origin/main"); err != nil {
		return "", err
	}
	return path, nil
}

// Remove deletes the conversation's checkout. A checkout with uncommitted work
// is left in place and the returned error says why; nothing is ever forced.
func (w *Worktrees) Remove(ctx context.Context, repo, thread string) error {
	if err := checkThread(thread); err != nil {
		return err
	}
	path := w.Path(thread)
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return git(ctx, repo, "worktree", "remove", path)
}

// branchName is the branch a conversation's own worktree is created on.
func branchName(thread string) string { return "polymux/" + thread }

func checkThread(thread string) error {
	if thread == "" || strings.ContainsAny(thread, "/\\.") {
		return &RepoError{Err: fmt.Errorf("invalid conversation name %q", thread)}
	}
	return nil
}

// git runs one git command in repo. A failure carries git's own message so the
// turn can explain what is wrong with the workspace.
func git(ctx context.Context, repo string, args ...string) error {
	command := exec.CommandContext(ctx, "git", append([]string{"-C", repo}, args...)...)
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return &RepoError{Err: fmt.Errorf("git %s: %w", strings.Join(args, " "), ctxErr)}
		}
		message := strings.TrimSpace(output.String())
		if message == "" {
			message = err.Error()
		}
		return &RepoError{Err: fmt.Errorf("git %s: %s", strings.Join(args, " "), message)}
	}
	return nil
}

// branchExists probes the repository without creating anything.
func branchExists(ctx context.Context, repo, branch string) bool {
	command := exec.CommandContext(ctx, "git", "-C", repo, "show-ref", "--verify", "--quiet", "refs/heads/"+branch)
	command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	return command.Run() == nil
}
