package agentruntime

import (
	"errors"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/testenv"
)

// git runs a git command and returns its trimmed output, failing the test on error.
func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

// gitRepo seeds a repository whose origin carries main, so a worktree can be
// created from origin/main the way a conversation creates it.
func gitRepo(t *testing.T, push bool) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	repo := t.TempDir()
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "polymux@example.test")
	runGit(t, repo, "config", "user.name", "Polymux")
	if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("polymux\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, repo, "add", "README.md")
	runGit(t, repo, "commit", "-m", "Seed")
	origin := t.TempDir()
	runGit(t, origin, "init", "--bare", "-b", "main")
	runGit(t, repo, "remote", "add", "origin", origin)
	if push {
		runGit(t, repo, "push", "origin", "main")
	}
	return repo
}

func testRuntime(t *testing.T, dir string) *Runtime {
	t.Helper()
	testenv.PiG(t)
	runtime, err := New(dir, "http://127.0.0.1:1", "local/test", "test-key", Client{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { runtime.Close() })
	return runtime
}

func TestWorkspaceWorktreePerThread(t *testing.T) {
	repo := gitRepo(t, true)
	runtime := testRuntime(t, t.TempDir())
	definition := func(scope string) Definition {
		return Definition{Agent: contract.Agent{ID: "coding", Name: "Coding", Model: "local/test"}, Prompt: "Work.", Scope: scope, Workspace: repo}
	}
	first, err := runtime.checkout(t.Context(), definition("chat-one"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := runtime.checkout(t.Context(), definition("chat-two"))
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatalf("two threads share a checkout: %q", first)
	}
	for thread, path := range map[string]string{"chat-one": first, "chat-two": second} {
		if branch := runGit(t, path, "rev-parse", "--abbrev-ref", "HEAD"); branch != "polymux/"+thread {
			t.Fatalf("thread %s is on branch %q", thread, branch)
		}
		if head, want := runGit(t, path, "rev-parse", "HEAD"), runGit(t, repo, "rev-parse", "origin/main"); head != want {
			t.Fatalf("thread %s does not start from origin/main", thread)
		}
	}
	if err := os.WriteFile(filepath.Join(first, "draft.txt"), []byte("chat-one only\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(second, "draft.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a file written in one conversation is visible in another")
	}
	if again, err := runtime.checkout(t.Context(), definition("chat-one")); err != nil || again != first {
		t.Fatalf("a later turn did not reuse the checkout: %q %v", again, err)
	}
}

func TestWorkspaceAbsentKeepsAgentDir(t *testing.T) {
	dir := t.TempDir()
	runtime := testRuntime(t, dir)
	cwd, err := runtime.checkout(t.Context(), Definition{Agent: contract.Agent{ID: "assistant", Model: "local/test"}, Prompt: "Chat."})
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(dir, "assistant"); cwd != want {
		t.Fatalf("agent without a workspace left its directory: %q", cwd)
	}
	if _, err := os.Stat(filepath.Join(dir, "worktrees")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("agent without a workspace prepared a worktree")
	}
}

func TestWorkspaceLiveDirectory(t *testing.T) {
	for _, name := range []string{"workspace", "absent"} {
		t.Run(name, func(t *testing.T) {
			runtime := openDurable(t, &httptest.Server{URL: "http://localhost"})
			d := Definition{Agent: contract.Agent{ID: "coding", Name: "Coding"}}
			want := filepath.Join(runtime.dir, "coding")
			if name == "workspace" {
				d.Worktree = t.TempDir()
				want = d.Worktree
			}
			session, err := runtime.Open(t.Context(), d, "")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = session.Close() })
			state, err := session.(*durableSession).conversation.Agent(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if state.Cwd == nil || *state.Cwd != want {
				t.Fatalf("live working directory = %v, want %q", state.Cwd, want)
			}
		})
	}
}

func TestWorkspaceFirstReply(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	d := Definition{Agent: contract.Agent{ID: "coding", Name: "Coding"}, Workspace: filepath.Join(home, "code", "Polymux"), Scope: "chat", Intro: true}
	prompt, err := buildPrompt(d, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "Working in ~/code/Polymux on branch polymux/chat") {
		t.Fatal("first reply does not identify the repository and branch")
	}
}

func TestWorkspaceRemovedOnDelete(t *testing.T) {
	repo := gitRepo(t, true)
	worktrees := NewWorktrees(t.TempDir())
	path, err := worktrees.Ensure(t.Context(), repo, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "unfinished.txt"), []byte("work\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := worktrees.Remove(t.Context(), repo, "chat"); err == nil {
		t.Fatal("a checkout with uncommitted work was removed")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the dirty checkout is gone: %v", err)
	}
	if err := os.Remove(filepath.Join(path, "unfinished.txt")); err != nil {
		t.Fatal(err)
	}
	if err := worktrees.Remove(t.Context(), repo, "chat"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the checkout survived deletion: %v", err)
	}
	if list := runGit(t, repo, "worktree", "list"); strings.Contains(list, path) {
		t.Fatalf("the repository still lists the deleted checkout: %s", list)
	}
	// Deleting a checkout keeps its branch, so the conversation can start again.
	if again, err := worktrees.Ensure(t.Context(), repo, "chat"); err != nil || again != path {
		t.Fatalf("the conversation could not start again: %q %v", again, err)
	}
}

func TestWorkspaceAddFailureExplained(t *testing.T) {
	repo := gitRepo(t, false) // origin has no main yet, so no worktree can be added
	worktrees := NewWorktrees(t.TempDir())
	_, err := worktrees.Ensure(t.Context(), repo, "chat")
	var repoErr *RepoError
	if !errors.As(err, &repoErr) {
		t.Fatalf("a failed worktree add was not explained: %v", err)
	}
	if !strings.HasPrefix(err.Error(), "Can't open repo:") || !strings.Contains(err.Error(), "origin/main") {
		t.Fatalf("the failure does not name the repository problem: %q", err)
	}
}
