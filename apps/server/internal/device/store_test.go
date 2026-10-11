package device

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func openStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.Context(), t.TempDir(), "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func issueTicket(t *testing.T, s *Store, url, agent string, caps []string) Ticket {
	t.Helper()
	text, err := s.Issue(t.Context(), url, agent, caps)
	if err != nil {
		t.Fatal(err)
	}
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(text, "polymux-pair:"))
	if err != nil {
		t.Fatal(err)
	}
	var ticket Ticket
	if err := json.Unmarshal(data, &ticket); err != nil {
		t.Fatal(err)
	}
	return ticket
}

func TestIdentity(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(t.Context(), dir, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	first := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native"})
	s.Close()
	s, err = Open(t.Context(), dir, "elsewhere")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	second := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native"})
	if first.Certificate != second.Certificate {
		t.Fatal("server identity changed")
	}
	if _, err := s.Issue(t.Context(), "https://elsewhere:7339", "assistant", []string{"native"}); err == nil {
		t.Fatal("changed identity accepted")
	}
	for _, path := range []string{filepath.Join(dir, "devices"), filepath.Join(dir, "devices", "pairing.db")} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0077 != 0 {
			t.Fatal("pairing identity is not owner-only")
		}
	}
}

func TestCertificates(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	first, err := s.certificate(nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Leaf.NotAfter.Sub(first.Leaf.NotBefore) > 91*24*time.Hour {
		t.Fatal("leaf exceeds Apple TLS validity limit")
	}
	roots := x509.NewCertPool()
	roots.AddCert(s.issuer)
	if _, err := first.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "127.0.0.1"}); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.cert = tls.Certificate{}
	s.mu.Unlock()
	second, err := s.certificate(nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Leaf.SerialNumber.Cmp(second.Leaf.SerialNumber) == 0 {
		t.Fatal("leaf was not renewed")
	}
	if string(first.Certificate[1]) != string(second.Certificate[1]) {
		t.Fatal("renewal changed the paired identity")
	}
	if _, err := second.Leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "127.0.0.1"}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			cert, err := s.certificate(nil)
			if err != nil || cert.Leaf.SerialNumber.Cmp(second.Leaf.SerialNumber) != 0 {
				t.Error("unstable concurrent certificate generation")
			}
		})
	}
	wg.Wait()
}

func TestEnrollment(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name  string
		caps  []string
		valid bool
	}{
		{"native", []string{"native"}, true}, {"narrowed", []string{"commands"}, true},
		{"duplicate", []string{"native", "native"}, false}, {"unknown", []string{"files"}, false}, {"empty", nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := openStore(t)
			ticket := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native", "commands"})
			p, err := s.Enroll(t.Context(), ticket.Code, "Mac", test.caps)
			if (err == nil) != test.valid {
				t.Fatalf("enrollment validity = %v, want %v", err, test.valid)
			}
			if !test.valid {
				return
			}
			if p.Agent != "assistant" || len(p.Token) != 43 {
				t.Fatal("invalid pairing")
			}
			if _, err := s.Enroll(t.Context(), ticket.Code, "other", test.caps); err == nil {
				t.Fatal("code reused")
			}
			if _, err := s.Authenticate(t.Context(), p.Token); err != nil {
				t.Fatal(err)
			}
			pairs, err := s.List(t.Context())
			if err != nil || len(pairs) != 1 {
				t.Fatal("pair missing")
			}
			encoded, _ := json.Marshal(pairs)
			if strings.Contains(string(encoded), p.Token) {
				t.Fatal("list exposed credential")
			}
			if err := s.Revoke(t.Context(), p.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Authenticate(t.Context(), p.Token); err == nil {
				t.Fatal("revoked credential accepted")
			}
		})
	}
}

func TestCodeRaces(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	ticket := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native"})
	var winners atomic.Int32
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Enroll(context.Background(), ticket.Code, "Mac", []string{"native"}); err == nil {
				winners.Add(1)
			}
		}()
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("%d enrollment winners", winners.Load())
	}
}

func TestExpiredCode(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	ticket := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native"})
	if _, err := s.db.Exec(`UPDATE tickets SET expires=?`, time.Now().Add(-time.Minute).Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Enroll(t.Context(), ticket.Code, "Mac", []string{"native"}); err == nil {
		t.Fatal("expired ticket accepted")
	}
	if _, err := s.Enroll(t.Context(), strings.Repeat("x", 43), "Mac", []string{"native"}); err == nil {
		t.Fatal("unknown ticket accepted")
	}
}

func TestCapabilities(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	ticket := issueTicket(t, s, "https://127.0.0.1:7339", "assistant", []string{"native"})
	if _, err := s.Enroll(t.Context(), ticket.Code, "Mac", []string{"commands"}); err == nil {
		t.Fatal("broadened approval")
	}
	if _, err := s.Enroll(t.Context(), ticket.Code, "Mac", []string{"native"}); err != nil {
		t.Fatal("failed enrollment consumed code")
	}
	for _, url := range []string{"http://127.0.0.1:7339", "https://u:p@127.0.0.1:7339", "https://127.0.0.1:7339?query=1"} {
		if _, err := s.Issue(t.Context(), url, "assistant", []string{"native"}); err == nil {
			t.Fatal("unsafe URL accepted")
		}
	}
}
