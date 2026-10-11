package settings

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
)

func TestSettingsPersistAndHideKey(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "settings.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	mode, model, theme := "live", "models/test-live", "dark"
	if _, err := s.Update(contract.SettingsPatch{VoiceMode: &mode, LiveModel: &model}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetKey("test-only-secret"); err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	v, err := s.Update(contract.SettingsPatch{Appearance: &theme})
	if err != nil {
		t.Fatal(err)
	}
	if v.LiveModel != model || v.VoiceMode != mode || v.Revision != before.Revision+1 {
		t.Fatal("partial update lost other settings")
	}
	wire, err := json.Marshal(v)
	if err != nil || strings.Contains(string(wire), "test-only-secret") || !reflect.DeepEqual(v.SpeechKeys, []string{"gemini"}) {
		t.Fatal("public settings exposed credentials or lost key presence")
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("settings file is not owner-only")
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(reopened.Snapshot(), v) {
		t.Fatal("settings did not survive reopening")
	}
	_, key := reopened.Speech()
	if key != "test-only-secret" {
		t.Fatal("server key did not persist")
	}
	if _, err := reopened.SetKey(""); err != nil {
		t.Fatal(err)
	}
	reopened, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Snapshot().SpeechKeys) != 0 {
		t.Fatal("key removal did not persist")
	}
}

func TestInvalidAndFailedWritesPreserveState(t *testing.T) {
	t.Parallel()
	s, err := Open(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	before := s.Snapshot()
	for _, test := range []struct {
		name  string
		patch contract.SettingsPatch
	}{
		{"provider", contract.SettingsPatch{LiveProvider: ptr("unknown")}},
		{"path model", contract.SettingsPatch{TextModel: ptr("../../secret")}},
		{"empty model", contract.SettingsPatch{LiveModel: ptr("")}},
		{"voice", contract.SettingsPatch{LiveVoice: ptr("unknown")}},
		{"theme", contract.SettingsPatch{Appearance: ptr("unknown")}},
		{"mode", contract.SettingsPatch{VoiceMode: ptr("unknown")}},
		{"width", contract.SettingsPatch{SidebarWidth: ptr(1.0)}},
		{"prompt", contract.SettingsPatch{VoicePrompt: ptr("")}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := s.Update(test.patch); !errors.Is(err, ErrInvalid) {
				t.Fatal("invalid settings accepted")
			}
			if !reflect.DeepEqual(before, s.Snapshot()) {
				t.Fatal("invalid write changed state")
			}
		})
	}
	if _, err := s.SetKey("header\ninjection"); !errors.Is(err, ErrInvalid) {
		t.Fatal("multiline key accepted")
	}
	if err := os.Remove(s.path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(contract.SettingsPatch{Appearance: ptr("light")}); err == nil {
		t.Fatal("failed persistence reported success")
	}
	if !reflect.DeepEqual(before, s.Snapshot()) {
		t.Fatal("failed persistence changed active settings")
	}
}

func TestConcurrentPatchesMerge(t *testing.T) {
	t.Parallel()
	s, err := Open(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for _, patch := range []contract.SettingsPatch{{Appearance: ptr("dark")}, {LiveModel: ptr("new-live")}, {TextModel: ptr("new-text")}} {
		group.Go(func() {
			if _, err := s.Update(patch); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	v := s.Snapshot()
	if v.Appearance != "dark" || v.LiveModel != "new-live" || v.TextModel != "new-text" || v.Revision != 4 {
		t.Fatal("concurrent field updates overwrote each other")
	}
}

func TestCorruptSettingsAreNotReset(t *testing.T) {
	t.Parallel()
	for _, test := range []struct{ name, data string }{
		{"broken JSON", "broken"}, {"missing settings", `{}`},
		{"null settings", `{"settings":null}`}, {"partial settings", `{"settings":{"appearance":"dark"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "settings.json")
			if err := os.WriteFile(path, []byte(test.data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Open(path); err == nil {
				t.Fatal("corrupt configuration silently reset")
			}
			data, err := os.ReadFile(path)
			if err != nil || string(data) != test.data {
				t.Fatal("corrupt configuration overwritten")
			}
		})
	}
}

func ptr[T any](value T) *T { return &value }
