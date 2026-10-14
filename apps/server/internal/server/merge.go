package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
	"github.com/MichaelKinsy/PiG/agent"
	"github.com/MichaelKinsy/PiG/ai"
)

func init() {
	agentruntime.WorkspaceTool = func(dir string) agent.AgentTool { return &mergeTool{dir: dir} }
}

type mergeTool struct{ dir string }
type mergeArgs struct {
	PR      int    `json:"pr"`
	HeadSHA string `json:"headSha"`
}

var mergeSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)

func (*mergeTool) Name() string                           { return "merge_pr" }
func (*mergeTool) Label() string                          { return "Squash-merge PR at reviewed head?" }
func (*mergeTool) ExecutionMode() agent.ToolExecutionMode { return agent.ToolModeSequential }
func (*mergeTool) Schema() ai.ToolSchema {
	return ai.ToolSchema{Name: "merge_pr", Description: "Request approval to squash-merge a PR at the exact reviewed head. For a card's merge intent, copy pr and headSha unchanged. Never replace a moved head or use bash to bypass approval.", Parameters: map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"pr", "headSha"},
		"properties": map[string]any{"pr": map[string]any{"type": "integer", "minimum": 1}, "headSha": map[string]any{"type": "string", "pattern": mergeSHA.String()}},
	}}
}
func (t *mergeTool) Execute(ctx context.Context, call string, raw json.RawMessage, _ agent.ToolUpdateCallback) (result agent.AgentToolResult, err error) {
	state, _ := ctx.Value(turnKey{}).(*turnState)
	if state == nil || state.store == nil {
		return result, fmt.Errorf("merge requires an approved approval")
	}
	state.mu.Lock()
	id := state.claims[call]
	delete(state.claims, call)
	state.mu.Unlock()
	approval, loadErr := state.store.Approval(ctx, id)
	key, keyErr := approvalKey(state.run.ID, "merge_pr", raw)
	if id == "" || loadErr != nil || keyErr != nil || approval.Key != key || approval.Status != store.ApprovalConsumed {
		return result, fmt.Errorf("merge requires approval for this exact PR and head")
	}
	status := "Merged"
	defer func() {
		if err != nil {
			status = err.Error()
		}
		data, _ := json.Marshal(map[string]string{"status": status})
		_ = state.store.SaveApprovalResult(context.WithoutCancel(ctx), id, data)
	}()
	var args mergeArgs
	if json.Unmarshal(raw, &args) != nil || args.PR < 1 || !mergeSHA.MatchString(args.HeadSHA) {
		return result, fmt.Errorf("invalid PR or reviewed head SHA")
	}
	data, err := repoOutput(ctx, t.dir, "gh", "pr", "view", strconv.Itoa(args.PR), "--json", "state,isDraft,headRefOid,statusCheckRollup")
	if err != nil {
		return result, fmt.Errorf("could not re-read PR: %w", err)
	}
	var pr struct {
		State, HeadRefOid string
		IsDraft           bool
		StatusCheckRollup []struct{ Status, Conclusion, State string }
	}
	if err = json.Unmarshal(data, &pr); err != nil {
		return result, err
	}
	switch {
	case pr.State != "OPEN":
		return result, fmt.Errorf("PR #%d is not open", args.PR)
	case pr.IsDraft:
		return result, fmt.Errorf("PR #%d is draft", args.PR)
	case pr.HeadRefOid != args.HeadSHA:
		return result, fmt.Errorf("PR #%d head moved; review the new head", args.PR)
	case len(pr.StatusCheckRollup) == 0:
		return result, fmt.Errorf("PR #%d has no successful checks", args.PR)
	}
	for _, check := range pr.StatusCheckRollup {
		if check.State != "SUCCESS" && (check.Status != "COMPLETED" || check.Conclusion != "SUCCESS") {
			return result, fmt.Errorf("PR #%d checks failing or pending", args.PR)
		}
	}
	if !filepath.IsAbs(state.mergeLane) {
		return result, fmt.Errorf("merge requires an absolute merge-lane path in server configuration")
	}
	script := filepath.Join(state.mergeLane, "scripts", "merge-queue.sh")
	name, argv := "gh", []string{"pr", "merge", strconv.Itoa(args.PR), "--squash", "--match-head-commit", args.HeadSHA}
	for _, path := range []string{script, filepath.Join(state.mergeLane, "scripts", "lanes.py")} {
		if _, statErr := os.Stat(path); statErr != nil {
			return result, fmt.Errorf("merge lane tooling unavailable: %w", statErr)
		}
	}
	enabled, probeErr := repoOutput(ctx, state.mergeLane, "python3", filepath.Join(state.mergeLane, "scripts", "lanes.py"), "lane", "merge", "enabled")
	if probeErr != nil {
		return result, fmt.Errorf("could not read merge lane configuration: %w", probeErr)
	}
	if strings.TrimSpace(string(enabled)) == "True" {
		name, argv = "bash", []string{script, "enqueue", strconv.Itoa(args.PR)}
		status = "Queued for merge"
	}
	_, err = repoOutput(ctx, state.mergeLane, name, argv...)
	if err != nil {
		return result, fmt.Errorf("merge refused: %w", err)
	}
	result.Content = []ai.ToolResultMessageContent{ai.TextContent{Text: status}}
	return result, nil
}
