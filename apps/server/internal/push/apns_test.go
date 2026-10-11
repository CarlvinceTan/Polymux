package push

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CarlvinceTan/luce/apps/server/internal/contract"
	"github.com/CarlvinceTan/luce/apps/server/internal/store"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fixtureSender(t *testing.T) *Sender {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	data, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "fixture.p8")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: data}), 0600); err != nil {
		t.Fatal(err)
	}
	sender, err := Open(Config{Path: path, KeyID: "TESTKEY123", TeamID: "TESTTEAM12", Topic: "com.carlvince.luce"})
	if err != nil {
		t.Fatal(err)
	}
	return sender
}

func TestAPNsSignsBoundedPrivateAlert(t *testing.T) {
	t.Parallel()
	sender := fixtureSender(t)
	sender.client = &http.Client{Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != "api.sandbox.push.apple.com" || request.Header.Get("apns-push-type") != "alert" || len(request.Header.Get("apns-collapse-id")) > 64 {
			t.Fatal("wrong APNs envelope")
		}
		token := strings.TrimPrefix(request.Header.Get("authorization"), "bearer ")
		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			t.Fatal("invalid JWT")
		}
		signature, err := base64.RawURLEncoding.DecodeString(parts[2])
		if err != nil || len(signature) != 64 {
			t.Fatal("invalid ES256 signature")
		}
		hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if !ecdsa.Verify(&sender.key.PublicKey, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
			t.Fatal("JWT signature failed")
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if len(body) > 4096 || json.Unmarshal(body, &payload) != nil || payload["server"] != "http://server.test:7337" || payload["conversationID"] != "chat" {
			t.Fatal("invalid routing payload")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})}
	item := store.Push{Device: contract.PushDevice{Token: strings.Repeat("ab", 32), Environment: "sandbox", Server: "http://server.test:7337"}, Notice: contract.Notice{Title: "Agent", ConversationID: "chat", MessageID: "message"}}
	if status := sender.Send(context.Background(), item); status != "sent" {
		t.Fatal(status)
	}
	first, err := sender.token()
	if err != nil {
		t.Fatal(err)
	}
	second, err := sender.token()
	if err != nil || first != second {
		t.Fatal("provider tokens unnecessarily regenerated")
	}
	for _, test := range []struct {
		name, body, want string
		status           int
	}{
		{"expired", `{"reason":"Unregistered"}`, "invalid", 410}, {"wrong-topic", `{"reason":"DeviceTokenNotForTopic"}`, "invalid", 400}, {"provider", `{"reason":"InternalServerError"}`, "failed", 500},
	} {
		t.Run(test.name, func(t *testing.T) {
			sender.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: test.status, Body: io.NopCloser(strings.NewReader(test.body))}, nil
			})
			if status := sender.Send(t.Context(), item); status != test.want {
				t.Fatalf("status %s", status)
			}
		})
	}
}
