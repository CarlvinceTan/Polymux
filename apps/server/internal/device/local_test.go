package device

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLocalCredential(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(t.Context(), dir, "localhost")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	token, err := s.Local(t.Context(), dir)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.Local(t.Context(), dir)
	if err != nil || again != token {
		t.Fatal("local credential changed")
	}
	info, err := os.Stat(filepath.Join(dir, "devices", "local-token"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credential must be owner-only")
	}
	pair, err := s.Authenticate(t.Context(), token)
	if err != nil || len(pair.Capabilities) != 0 {
		t.Fatal("local credential granted native capabilities")
	}
	if err := s.Revoke(t.Context(), pair.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Local(t.Context(), dir); err == nil {
		t.Fatal("revoked credential recreated")
	}
}
