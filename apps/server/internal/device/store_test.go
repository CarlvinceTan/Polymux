package device

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
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

func appCode(t *testing.T, s *Store, urls []string) string {
	t.Helper()
	uri, err := s.IssueApp(t.Context(), urls, "assistant")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(uri)
	if err != nil || len(u.Query().Get("c")) != 43 {
		t.Fatal(uri)
	}
	return uri
}

func TestConcurrentRedeemApp(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	s, err := Open(t.Context(), dir, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	other, err := Open(t.Context(), dir, "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	urls := []string{"https://mac.example:7339"}
	first := appCode(t, s, urls)
	code := codeOf(t, appCode(t, s, urls))
	if _, err := s.RedeemApp(t.Context(), "peer", codeOf(t, first)); !errors.Is(err, ErrUsed) {
		t.Fatal(err)
	}
	var wins atomic.Int32
	var wg sync.WaitGroup
	for _, handle := range []*Store{s, other} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := handle.RedeemApp(context.Background(), "peer", code); err == nil {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("winners = %d", wins.Load())
	}
}

func TestCodeExpiresAt3Min(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	now := time.Unix(1_700_000_000, 0)
	s.clock = func() time.Time { return now }
	urls := []string{"https://mac.example:7339"}
	uri := appCode(t, s, urls)
	now = now.Add(3*time.Minute - time.Second)
	if _, err := s.RedeemApp(t.Context(), "peer", codeOf(t, uri)); err != nil {
		t.Fatal(err)
	}
	uri = appCode(t, s, urls)
	now = now.Add(3 * time.Minute)
	if _, err := s.RedeemApp(t.Context(), "peer", codeOf(t, uri)); !errors.Is(err, ErrExpired) {
		t.Fatal(err)
	}
}

func TestQRPayloadNoLoopback(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	uri := appCode(t, s, []string{"https://127.0.0.1:7339", "https://[::1]:7339", "https://localhost:7339", "https://mac.example:7339"})
	q, _ := url.Parse(uri)
	sum := sha256.Sum256(s.issuer.Raw)
	params := q.Query()
	if params.Get("v") != "2" || params.Get("fp") != hex.EncodeToString(sum[:]) || len(params["u"]) != 1 || !strings.Contains(params["u"][0], "mac.example") {
		t.Fatal(uri)
	}
	if strings.Contains(uri, "127.0.0.1") || strings.Contains(uri, "localhost") || strings.Contains(uri, "::1") || strings.Contains(uri, "%3A%3A1") {
		t.Fatal(uri)
	}
}

func TestLockoutPerCaller(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	now := time.Unix(1_700_000_000, 0)
	open := func() *Store {
		t.Helper()
		s, err := Open(t.Context(), dir, "127.0.0.1")
		if err != nil {
			t.Fatal(err)
		}
		s.clock = func() time.Time { return now }
		return s
	}
	s := open()
	urls := []string{"https://mac.example:7339"}
	code := codeOf(t, appCode(t, s, urls))
	bad := strings.Repeat("b", 43)
	for range 3 {
		if _, err := s.RedeemApp(t.Context(), "a", bad); !errors.Is(err, ErrUsed) {
			t.Fatal(err)
		}
	}
	s.Close()
	s = open()
	for range 2 {
		if _, err := s.RedeemApp(t.Context(), "a", bad); !errors.Is(err, ErrUsed) {
			t.Fatal(err)
		}
	}
	if _, err := s.RedeemApp(t.Context(), "a", code); !errors.Is(err, ErrLocked) {
		t.Fatal(err)
	}
	if agent, err := s.RedeemApp(t.Context(), "b", code); err != nil || agent != "assistant" {
		t.Fatalf("other caller: %v", err)
	}
	now = now.Add(15*time.Minute + time.Second)
	s.Close()
	s = open()
	defer s.Close()
	if agent, err := s.RedeemApp(t.Context(), "a", codeOf(t, appCode(t, s, urls))); err != nil || agent != "assistant" {
		t.Fatal(err)
	}
}

func TestLinkHasNoPolymuxHost(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	if _, err := s.IssueApp(t.Context(), nil, "assistant"); !errors.Is(err, ErrNoAddress) {
		t.Fatal(err)
	}
	if _, err := s.IssueApp(t.Context(), []string{"https://connect.polymux.com"}, "assistant"); !errors.Is(err, ErrNoAddress) {
		t.Fatal(err)
	}
	uri := appCode(t, s, []string{"https://connect.polymux.com", "https://mac.example:7339"})
	if strings.Contains(strings.ToLower(uri), "polymux.com") {
		t.Fatal(uri)
	}
}

func TestEnrollSkipsAppTicket(t *testing.T) {
	t.Parallel()
	s := openStore(t)
	code := codeOf(t, appCode(t, s, []string{"https://mac.example:7339"}))
	_, err := s.Enroll(t.Context(), code, "Mac", []string{"native"})
	if err == nil || err.Error() != "pairing code expired or already used" {
		t.Fatal(err)
	}
	if _, err := s.RedeemApp(t.Context(), "peer", code); err != nil {
		t.Fatal(err)
	}
}

func TestIdentityRejectsUnspecified(t *testing.T) {
	t.Parallel()
	if _, err := Open(t.Context(), t.TempDir(), "0.0.0.0"); err == nil {
		t.Fatal("accepted unspecified host")
	}
}

func codeOf(t *testing.T, uri string) string {
	t.Helper()
	u, err := url.Parse(uri)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("c")
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
