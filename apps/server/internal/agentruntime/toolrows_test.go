package agentruntime

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/MichaelKinsy/PiG/ai"
)

// The chat row data the tool events carry: a bounded, redacted argument summary and a
// result excerpt capped at 2 KB and valid UTF-8.
func TestToolEventCarriesArgsSummary(t *testing.T) {
	if got := toolSummary("bash", json.RawMessage(`{"command":"API_KEY=sk-1 go test ./..."}`)); got != "[redacted] go test ./..." {
		t.Fatalf("summary %q", got)
	}
	if got := toolSummary("read", json.RawMessage(`{"path":"a/`+strings.Repeat("b", 400)+`.swift"}`)); len(got) > 200 || !strings.HasSuffix(got, "…") {
		t.Fatalf("long summary %q", got)
	}
	if got := toolSummary("bash", nil); got != "" {
		t.Fatalf("empty summary %q", got)
	}
}

func TestToolOutputExcerptCapped(t *testing.T) {
	if got := toolExcerpt([]ai.ToolResultMessageContent{ai.TextContent{Text: strings.Repeat("line\n", 2000)}}); len(got) > 2048 || !strings.HasPrefix(got, "line\n") {
		t.Fatalf("excerpt %d bytes", len(got))
	}
	if got := toolExcerpt([]ai.ToolResultMessageContent{ai.TextContent{Text: strings.Repeat("é", 3000)}}); len(got) > 2048 || !utf8.ValidString(got) {
		t.Fatalf("multibyte excerpt %d bytes", len(got))
	}
}
