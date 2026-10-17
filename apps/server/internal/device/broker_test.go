package device

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func fixture(t *testing.T) (*Broker, *Store, *httptest.Server, Enrollment) {
	t.Helper()
	s := openStore(t)
	b := New(s)
	server := httptest.NewUnstartedServer(b)
	server.TLS = s.TLSConfig()
	server.TLS.Certificates = []tls.Certificate{s.cert}
	server.StartTLS()
	t.Cleanup(func() { b.Close(); server.Close() })
	ticket := issueTicket(t, s, server.URL, "assistant", []string{"native", "commands"})
	p, err := s.Enroll(t.Context(), ticket.Code, "Mac", []string{"native", "commands"})
	if err != nil {
		t.Fatal(err)
	}
	return b, s, server, p
}

func connect(t *testing.T, s *Store, server *httptest.Server, p Enrollment, hello Packet) *websocket.Conn {
	t.Helper()
	roots := x509.NewCertPool()
	cert, err := x509.ParseCertificate(s.issuer.Raw)
	if err != nil {
		t.Fatal(err)
	}
	roots.AddCert(cert)
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}, HandshakeTimeout: time.Second}
	ws, _, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/connect", http.Header{"Authorization": []string{"Bearer " + p.Token}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	if err := ws.WriteJSON(hello); err != nil {
		t.Fatal(err)
	}
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	var ack Packet
	if err := ws.ReadJSON(&ack); err != nil {
		t.Fatal(err)
	}
	if ack.Type != "ready" {
		t.Fatal("connection not acknowledged")
	}
	return ws
}

func TestBrokerDispatch(t *testing.T) {
	t.Parallel()
	b, s, server, p := fixture(t)
	ws := connect(t, s, server, p, Packet{Type: "hello", Capabilities: []string{"commands"}})
	if _, err := b.Call(t.Context(), "other", p.ID, "command", json.RawMessage(`{}`)); err == nil {
		t.Fatal("agent boundary crossed")
	}
	if _, err := b.Call(t.Context(), "assistant", p.ID, "click", json.RawMessage(`{}`)); err == nil {
		t.Fatal("unready native capability accepted")
	}
	result := make(chan Packet, 1)
	failed := make(chan error, 1)
	go func() {
		packet, err := b.Call(t.Context(), "assistant", p.ID, "command", json.RawMessage(`{"command":"/usr/bin/true"}`))
		if err != nil {
			failed <- err
		} else {
			result <- packet
		}
	}()
	var request Packet
	if err := ws.ReadJSON(&request); err != nil {
		t.Fatal(err)
	}
	if request.Type != "request" || request.ID == "" || request.Operation != "command" {
		t.Fatal("wrong request")
	}
	if err := ws.WriteJSON(Packet{Type: "result", ID: request.ID, Content: []Content{{Type: "text", Text: "verified fixture"}, {Type: "image", Data: "aW1hZ2U=", MimeType: "image/png"}}}); err != nil {
		t.Fatal(err)
	}
	select {
	case packet := <-result:
		if len(packet.Content) != 2 || packet.Content[1].Type != "image" {
			t.Fatal("lost image evidence")
		}
	case err := <-failed:
		t.Fatal(err)
	case <-time.After(3 * time.Second):
		t.Fatal("call did not finish")
	}
	states, err := b.List(t.Context(), "assistant")
	if err != nil || len(states) != 1 || !states[0].Connected {
		t.Fatal("device status missing")
	}
	states, err = b.List(t.Context(), "other")
	if err != nil || len(states) != 0 {
		t.Fatal("private device listed")
	}
}

func TestBrokerInterruption(t *testing.T) {
	t.Parallel()
	b, s, server, p := fixture(t)
	ws := connect(t, s, server, p, Packet{Type: "hello", Capabilities: []string{"commands"}})
	ctx, cancel := context.WithCancel(t.Context())
	result := make(chan error, 1)
	go func() { _, err := b.Call(ctx, "assistant", p.ID, "command", json.RawMessage(`{}`)); result <- err }()
	var request Packet
	if err := ws.ReadJSON(&request); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-result:
		if err == nil || !strings.Contains(err.Error(), "unknown") {
			t.Fatal("interruption reported success")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("call stuck")
	}
	if err := ws.ReadJSON(&request); err == nil {
		t.Fatal("interrupted generation left open")
	}
}

func TestBrokerRevocation(t *testing.T) {
	t.Parallel()
	b, s, server, p := fixture(t)
	ws := connect(t, s, server, p, Packet{Type: "hello", Capabilities: []string{"commands"}})
	if err := s.Revoke(t.Context(), p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Call(t.Context(), "assistant", p.ID, "command", json.RawMessage(`{}`)); err == nil {
		t.Fatal("revoked call dispatched")
	}
	var request Packet
	if err := ws.ReadJSON(&request); err == nil {
		t.Fatal("revoked generation open")
	}
}

func TestControlIngress(t *testing.T) {
	t.Parallel()
	b, s, server, p := fixture(t)
	for _, test := range []struct {
		name   string
		method string
		path   string
		token  string
		origin string
		tls    bool
		want   int
	}{
		{"plaintext", "POST", "/enroll", "", "", false, 403},
		{"unauthenticated", "GET", "/connect", "", "", true, 403},
		{"browser", "GET", "/connect", p.Token, "https://example.com", true, 403},
		{"unknown", "GET", "/unknown", p.Token, "", true, 404},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest(test.method, "https://127.0.0.1"+test.path, nil)
			if test.tls {
				r.TLS = &tls.ConnectionState{}
			} else {
				r.TLS = nil
			}
			r.Header.Set("Authorization", "Bearer "+test.token)
			r.Header.Set("Origin", test.origin)
			w := httptest.NewRecorder()
			b.ServeHTTP(w, r)
			if w.Code != test.want {
				t.Fatalf("status=%d, want %d", w.Code, test.want)
			}
		})
	}
	_ = s
	_ = server
	for _, name := range []string{"get_browser_state", "page", "browser_click", "check_permissions", "config", "run_command"} {
		if NativeTool(name) {
			t.Fatal("unsafe native tool admitted")
		}
	}
}
