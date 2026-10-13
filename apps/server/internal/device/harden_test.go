package device

import (
	"crypto/tls"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBurnedOnFirstUse(t *testing.T) {
	s := openStore(t)
	code := codeOf(t, appCode(t, s, []string{"https://mac.example"}))
	if _, err := s.RedeemApp(t.Context(), "a", code); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RedeemApp(t.Context(), "b", code); err == nil {
		t.Fatal("reused code")
	}
}

func TestGlobalHandshakeRateLimit(t *testing.T) {
	var l Limiter
	now := time.Now()
	for range 20 {
		if !l.Allow("a", now) {
			t.Fatal("early limit")
		}
	}
	if l.Allow("a", now) {
		t.Fatal("unlimited source")
	}
	if !l.Allow("b", now) || !l.Allow("a", now.Add(time.Minute)) {
		t.Fatal("source isolation or expiry")
	}
	r := httptest.NewRequest("POST", "/redeem", nil)
	r.RemoteAddr = "127.0.0.1:4444"
	r.Header.Set("X-Forwarded-For", "203.0.113.1")
	if Caller(r) != "route:device" {
		t.Fatal("untrusted caller")
	}
}

func TestPrePairRevealsNothing(t *testing.T) {
	b := New(openStore(t))
	for _, path := range []string{"/", "/enroll", "/redeem", "/connect", "/pairing", "/version", "/unknown"} {
		r := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		r.TLS = &tls.ConnectionState{}
		w := httptest.NewRecorder()
		b.ServeHTTP(w, r)
		if w.Code != 403 || w.Body.String() != string(make([]byte, 64)) {
			t.Fatalf("%s leaked: %d %q", path, w.Code, w.Body.String())
		}
	}
}

func TestPairedEventEmitted(t *testing.T) {
	s := openStore(t)
	b := New(s)
	code := codeOf(t, appCode(t, s, []string{"https://mac.example"}))
	for i := range 2 {
		r := httptest.NewRequest("POST", "/redeem", strings.NewReader(`{"code":"`+code+`"}`))
		r.TLS = &tls.ConnectionState{}
		w := httptest.NewRecorder()
		b.ServeHTTP(w, r)
		if i == 0 {
			var p Enrollment
			if json.Unmarshal(w.Body.Bytes(), &p) != nil || p.ID == "" || len(b.events) != 1 || b.events[0].Type != "device.paired" || b.events[0].ID != p.ID {
				t.Fatal("missing pairing event")
			}
			if _, err := s.Authenticate(t.Context(), p.Token); err != nil {
				t.Fatal(err)
			}
			if err := s.Revoke(t.Context(), p.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Authenticate(t.Context(), p.Token); err == nil {
				t.Fatal("revoke failed")
			}
		} else if w.Code != 403 || len(b.events) != 1 {
			t.Fatal("replay emitted pairing")
		}
	}
	r := httptest.NewRequest("GET", "/device/events", nil)
	r.RemoteAddr = "203.0.113.1:4444"
	w := httptest.NewRecorder()
	b.Paired(w, r)
	if w.Code != 403 || w.Body.Len() != 64 {
		t.Fatal("remote event disclosure")
	}
}
