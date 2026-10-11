package agentruntime

import (
	"strings"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

// A conversation must survive a harness restart, which is what makes the storage durable.
func TestDurableConversationSurvivesRestart(t *testing.T) {
	provider, requests := recordingProvider(t)
	dir := t.TempDir()
	definition := Definition{Agent: contract.Agent{ID: "assistant", Name: "Assistant"}}

	storage, closeStorage, err := NewDurableStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := NewDurable(t.Context(), dir, provider.URL+"/v1", "test-model", "test-key", Client{}, storage)
	if err != nil {
		t.Fatal(err)
	}
	session, err := runtime.Open(t.Context(), definition, "")
	if err != nil {
		t.Fatal(err)
	}
	path := session.Path()
	if _, err := session.Send(t.Context(), turn("remember ALPHA"), nil); err != nil {
		t.Fatal(err)
	}
	if err := runtime.Close(); err != nil {
		t.Fatal(err)
	}
	if err := closeStorage(); err != nil {
		t.Fatal(err)
	}

	// A fresh harness over the same directory resumes the same conversation.
	reopened, closeAgain, err := NewDurableStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer closeAgain()
	restarted, err := NewDurable(t.Context(), dir, provider.URL+"/v1", "test-model", "test-key", Client{}, reopened)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	resumed, err := restarted.Open(t.Context(), definition, path)
	if err != nil {
		t.Fatal(err)
	}
	if resumed.Path() != path {
		t.Fatalf("resumed %q want %q", resumed.Path(), path)
	}
	if _, err := resumed.Send(t.Context(), turn("what should you remember"), nil); err != nil {
		t.Fatal(err)
	}
	seen := requests()
	if len(seen) != 2 {
		t.Fatalf("requests %d", len(seen))
	}
	if !strings.Contains(seen[1], "ALPHA") {
		t.Fatalf("restarted harness lost the conversation: %s", seen[1])
	}
}
