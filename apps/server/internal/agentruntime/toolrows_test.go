package agentruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"unicode/utf8"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/MichaelKinsy/PiG/agent"
	"github.com/MichaelKinsy/PiG/ai"
)

// commandTool names itself bash so the row summary path is exercised without builtins.
type commandTool struct{}

func (*commandTool) Name() string                           { return "bash" }
func (*commandTool) Label() string                          { return "Bash" }
func (*commandTool) ExecutionMode() agent.ToolExecutionMode { return agent.ToolModeSequential }
func (*commandTool) Description() string                    { return "run a command" }
func (*commandTool) Schema() ai.ToolSchema {
	return ai.ToolSchema{Name: "bash", Description: "run", Parameters: map[string]any{
		"type": "object", "additionalProperties": false, "properties": map[string]any{"command": map[string]any{"type": "string"}},
	}}
}

func (*commandTool) Execute(context.Context, string, json.RawMessage, agent.ToolUpdateCallback) (agent.AgentToolResult, error) {
	return agent.AgentToolResult{Content: []ai.ToolResultMessageContent{ai.TextContent{Text: "ok output\nTOKEN=leaked-secret"}}}, nil
}

// A chat row needs a bounded argument summary at start and a result excerpt at done, with
// credential-looking values kept out of both.
func TestToolEventCarriesArgsSummary(t *testing.T) {
	var hits atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) == 1 {
			sse(w, "", []map[string]any{{"index": 0, "id": "call", "type": "function", "function": map[string]string{
				"name": "bash", "arguments": `{"command":"export API_KEY=sk-1234567890 && go test ./..."}`}}})
			return
		}
		sse(w, "Done.", nil)
	}))
	t.Cleanup(provider.Close)
	runtime := openDurable(t, provider)
	definition := Definition{Agent: contract.Agent{ID: "rows", Name: "Rows"}, ExtraTools: []agent.AgentTool{&commandTool{}},
		BeforeTool: func(context.Context, string, string, json.RawMessage) agent.ToolCallHookResult {
			return agent.ToolCallHookResult{}
		}}
	session, err := runtime.Open(t.Context(), definition, "")
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	seen := map[string]Delta{}
	if _, err := session.Send(t.Context(), turn("run tests"), func(delta Delta) error {
		if delta.Kind == "tool.start" || delta.Kind == "tool.done" {
			mu.Lock()
			seen[delta.Kind] = delta
			mu.Unlock()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	start := seen["tool.start"]
	if want := "export API_KEY=[redacted] && go test ./..."; start.Summary != want {
		t.Fatalf("summary %q want %q", start.Summary, want)
	}
	done := seen["tool.done"]
	if done.Failed || !strings.Contains(done.Output, "ok output") || strings.Contains(done.Output, "leaked-secret") {
		t.Fatalf("excerpt %q failed=%v", done.Output, done.Failed)
	}
}

func TestToolOutputExcerptCapped(t *testing.T) {
	long := toolExcerpt([]ai.ToolResultMessageContent{ai.TextContent{Text: strings.Repeat("line\n", 2000)}})
	if len(long) > toolOutputLimit || !strings.HasPrefix(long, "line\n") {
		t.Fatalf("excerpt %d bytes", len(long))
	}
	multibyte := toolExcerpt([]ai.ToolResultMessageContent{ai.TextContent{Text: strings.Repeat("é", 3000)}})
	if len(multibyte) > toolOutputLimit || !utf8.ValidString(multibyte) {
		t.Fatalf("multibyte excerpt %d bytes", len(multibyte))
	}
	joined := toolExcerpt([]ai.ToolResultMessageContent{ai.TextContent{Text: "first"}, ai.TextContent{Text: "second"}})
	if joined != "first\nsecond" {
		t.Fatalf("joined excerpt %q", joined)
	}
	if summary := toolSummary("read", json.RawMessage(`{"path":"`+strings.Repeat("a", 500)+`"}`)); len(summary) > toolSummaryLimit || !strings.HasSuffix(summary, "…") {
		t.Fatalf("summary %d bytes %q", len(summary), summary)
	}
	if summary := toolSummary("find", json.RawMessage(`{"pattern":"main.go"}`)); summary != "main.go" {
		t.Fatalf("find summary %q", summary)
	}
}
