package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
	"github.com/MichaelKinsy/PiG/ai"
)

const reviewedSHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

var mergeInput = json.RawMessage(`{"pr":84,"headSha":"` + reviewedSHA + `"}`)

func mergeFixture(t *testing.T, fields string) (*mergeTool, context.Context, *turnState) {
	t.Helper()
	db := openApprovalStore(t)
	state := &turnState{run: seedApprovalRun(t, db, "merge"), store: db, external: map[string]bool{"merge_pr": true}}
	dir := t.TempDir()
	bin := t.TempDir()
	script := "#!/bin/sh\nif [ \"$2\" = view ]; then echo '{\"state\":\"OPEN\",\"number\":84,\"isCrossRepository\":false,\"headRefName\":\"dev\",\"baseRefName\":\"main\",\"headRefOid\":\"" + reviewedSHA + "\",\"statusCheckRollup\":[{\"status\":\"COMPLETED\",\"conclusion\":\"SUCCESS\"}]," + fields + "}'; else printf '%s\\n' \"$@\" > argv; fi\n"
	for name, content := range map[string]string{"gh": script, "git": "#!/bin/sh\npwd\n"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(content), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	state.mergeRoot = t.TempDir()
	return &mergeTool{dir: dir}, context.WithValue(t.Context(), turnKey{}, state), state
}
func approveMerge(t *testing.T, ctx context.Context, state *turnState) {
	t.Helper()
	if gate := beforeTool(ctx, "call", "merge_pr", mergeInput); !gate.Block || state.approval == nil {
		t.Fatalf("missing approval: %+v", gate)
	}
	if _, err := state.store.DecideApproval(ctx, state.approval.ID, store.ApprovalApproved); err != nil {
		t.Fatal(err)
	}
	if gate := beforeTool(ctx, "call", "merge_pr", mergeInput); gate.Block {
		t.Fatal(gate.Reason)
	}
}
func TestMergeNeedsApproval(t *testing.T) {
	for _, trigger := range []string{"message", "routine", "follow_up", "task", "event"} {
		t.Run(trigger, func(t *testing.T) {
			tool, ctx, state := mergeFixture(t, `"isDraft":false`)
			state.work.Trigger = trigger
			state.classes = map[string]ToolClass{"merge_pr": ToolRead}
			if _, err := tool.Execute(ctx, "call", mergeInput, nil); err == nil {
				t.Fatal("unapproved merge executed")
			}
			if gate := beforeTool(ctx, "call", "merge_pr", mergeInput); !gate.Block || state.approval == nil {
				t.Fatal("merge auto-approved")
			}
			if _, err := os.Stat(filepath.Join(state.mergeRoot, "argv")); !os.IsNotExist(err) {
				t.Fatal("gh merge ran")
			}
		})
	}
}
func TestMergeRefusesMovedHead(t *testing.T) {
	mergeRefusal(t, `"headRefOid":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"`, "head moved")
}
func TestMergeRefusesFailingChecks(t *testing.T) {
	mergeRefusal(t, `"statusCheckRollup":[{"status":"COMPLETED","conclusion":"FAILURE"}]`, "checks failing")
}
func TestMergeRefusesDraft(t *testing.T)  { mergeRefusal(t, `"isDraft":true`, "draft") }
func TestMergeRefusesClosed(t *testing.T) { mergeRefusal(t, `"state":"CLOSED"`, "not open") }
func TestMergeRefusesNoChecks(t *testing.T) {
	mergeRefusal(t, `"statusCheckRollup":[]`, "no successful checks")
}
func TestMergeRefusesPendingChecks(t *testing.T) {
	mergeRefusal(t, `"statusCheckRollup":[{"status":"IN_PROGRESS"}]`, "checks failing or pending")
}
func TestMergeRefusesFeatureHead(t *testing.T) {
	mergeRefusal(t, `"headRefName":"feature"`, "promote dev to main")
}
func TestMergeRefusesFeatureBase(t *testing.T) {
	mergeRefusal(t, `"baseRefName":"feature"`, "promote dev to main")
}
func TestMergeRefusesFork(t *testing.T) {
	mergeRefusal(t, `"isCrossRepository":true`, "this repository's dev branch")
}
func mergeRefusal(t *testing.T, fields, reason string) {
	t.Helper()
	tool, ctx, state := mergeFixture(t, fields)
	approveMerge(t, ctx, state)
	if _, err := tool.Execute(ctx, "call", mergeInput, nil); err == nil || !strings.Contains(err.Error(), reason) {
		t.Fatalf("refusal: %v", err)
	}
	approval, err := state.store.Approval(ctx, state.approval.ID)
	if err != nil || approval.Status != store.ApprovalConsumed || !strings.Contains(string(approval.Result), reason) {
		t.Fatalf("approval: %+v %v", approval, err)
	}
	if gate := beforeTool(ctx, "retry", "merge_pr", mergeInput); !gate.Block {
		t.Fatal("consumed approval reused")
	}
	if _, err := os.Stat(filepath.Join(state.mergeRoot, "argv")); !os.IsNotExist(err) {
		t.Fatal("gh merge ran")
	}
}
func TestMergeRequiresQueue(t *testing.T) {
	tool, ctx, state := mergeFixture(t, `"isDraft":false`)
	approveMerge(t, ctx, state)
	if _, err := tool.Execute(ctx, "call", mergeInput, nil); err == nil || !strings.Contains(err.Error(), "requires the merge queue") {
		t.Fatalf("direct promotion was accepted: %v", err)
	}
	if agentruntime.WorkspaceTool(tool.dir).Name() != "merge_pr" {
		t.Fatal("workspace tool missing")
	}
}
func TestMergeUsesQueueWhenConfigured(t *testing.T) {
	tool, ctx, state := mergeFixture(t, `"isDraft":false`)
	state.mergeQueue = true
	writeQueueScript(t, state.mergeRoot, "#!/bin/sh\nprintf '%s\\n' \"$@\" > queued\n")
	approveMerge(t, ctx, state)
	result, err := tool.Execute(ctx, "call", mergeInput, nil)
	if err != nil || result.Content[0].(ai.TextContent).Text != "Queued for promotion" {
		t.Fatalf("queue: %+v %v", result, err)
	}
	queued, err := os.ReadFile(filepath.Join(state.mergeRoot, "queued"))
	if err != nil || string(queued) != "enqueue\n84\n" {
		t.Fatalf("queue argv: %s %v", queued, err)
	}
	if _, err := os.Stat(filepath.Join(state.mergeRoot, "argv")); !os.IsNotExist(err) {
		t.Fatal("queue bypassed")
	}
}
func writeQueueScript(t *testing.T, dir, content string) {
	t.Helper()
	scripts := filepath.Join(dir, "scripts", "merge")
	if err := os.MkdirAll(scripts, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(scripts, "merge-queue.sh"), []byte(content), 0700); err != nil {
		t.Fatal(err)
	}
}

func TestMergeIgnoresWorktreeScripts(t *testing.T) {
	tool, ctx, state := mergeFixture(t, `"isDraft":false`)
	state.mergeQueue = true
	writeQueueScript(t, tool.dir, "touch trapped\nexit 99\n")
	writeQueueScript(t, state.mergeRoot, "printf '%s\\n' \"$@\" > queued\n")
	approveMerge(t, ctx, state)
	if _, err := tool.Execute(ctx, "call", mergeInput, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(state.mergeRoot, "queued")); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{tool.dir, state.mergeRoot} {
		if _, err := os.Stat(filepath.Join(dir, "trapped")); !os.IsNotExist(err) {
			t.Fatal("worktree tooling executed")
		}
	}
}

func TestMergeRequiresRoot(t *testing.T) {
	for _, root := range []string{"", "relative"} {
		name := root
		if name == "" {
			name = "empty" // an empty name becomes #00, and # cuts the sqlite file: URI short
		}
		t.Run(name, func(t *testing.T) {
			tool, ctx, state := mergeFixture(t, `"isDraft":false`)
			state.mergeRoot = root
			approveMerge(t, ctx, state)
			if _, err := tool.Execute(ctx, "call", mergeInput, nil); err == nil || !strings.Contains(err.Error(), "merge") {
				t.Fatalf("refusal: %v", err)
			}
			if _, err := os.Stat(filepath.Join(tool.dir, "argv")); !os.IsNotExist(err) {
				t.Fatal("merge fallback ran")
			}
		})
	}
}

func TestMergeQueueRequiresTooling(t *testing.T) {
	tool, ctx, state := mergeFixture(t, `"isDraft":false`)
	state.mergeQueue = true
	approveMerge(t, ctx, state)
	if _, err := tool.Execute(ctx, "call", mergeInput, nil); err == nil || !strings.Contains(err.Error(), "tooling unavailable") {
		t.Fatalf("refusal: %v", err)
	}
}
