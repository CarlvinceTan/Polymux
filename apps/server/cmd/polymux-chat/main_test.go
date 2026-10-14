package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

const secret = "test-device-secret"

func check(t *testing.T, ok bool, format string, args ...any) {
	t.Helper()
	if !ok {
		t.Errorf(format, args...)
	}
}
func setup(t *testing.T, handler http.HandlerFunc) string {
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	path := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(path, []byte(secret+"\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("POLYMUX_API", server.URL)
	t.Setenv("POLYMUX_TOKEN_FILE", path)
	t.Setenv("POLYMUX_THREAD", "test")
	t.Setenv("WAIT_SECS", "20")
	return path
}
func invoke(t *testing.T, args ...string) (int, string, string) {
	var out, stderr bytes.Buffer
	clock := time.Unix(0, 0)
	code := run(args, &out, &stderr, func() time.Time { return clock }, func(d time.Duration) { clock = clock.Add(d) })
	check(t, !(strings.Contains(out.String()+stderr.String(), secret)), "device token leaked")
	return code, out.String(), stderr.String()
}
func TestChatUnauthorizedClearError(t *testing.T) {
	for _, status := range []int{401, 403} {
		path := setup(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) })
		check(t, os.WriteFile(path, nil, 0600) == nil, "clear token")
		code, out, stderr := invoke(t, "read")
		want := fmt.Sprintf("polymux-chat: HTTP %d on GET /threads/test/messages: device token rejected (check %s / pairing)\n", status, path)
		check(t, !(code != 1 || out != "" || stderr != want), "got %d %q %q", code, out, stderr)
	}
}
func TestChatSendsBearerToken(t *testing.T) {
	for _, nested := range []bool{false, true} {
		setup(t, func(w http.ResponseWriter, r *http.Request) {
			check(t, !(r.Header.Get("Authorization") != "Bearer "+secret), "missing bearer token")
			check(t, !(r.URL.Path != "/threads/override/messages"), "wrong thread")
			if r.Method == "POST" {
				var p struct {
					ID, Text      string
					AttachmentIDs []string
				}
				check(t, !(json.NewDecoder(r.Body).Decode(&p) != nil || p.Text != "hello" || p.AttachmentIDs == nil || len(p.AttachmentIDs) != 0 || !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(p.ID)), "invalid send payload")
				fmt.Fprint(w, map[bool]string{true: `{"message":{"seq":2}}`, false: `{"seq":2}`}[nested])
			} else {
				body := `[{"seq":1},{"seq":2,"role":"assistant","status":"complete","parts":[{"text":"hel"},{"text":"lo"}]}]`
				fmt.Fprint(w, map[bool]string{false: body, true: `{"messages":` + body + `}`}[nested])
			}
		})
		code, out, stderr := invoke(t, "--thread", "override", "send", "hello")
		check(t, !(code != 0 || out != "sent seq 2\n" || stderr != ""), "send: %d %q %q", code, out, stderr)
		code, out, stderr = invoke(t, "read", "--thread", "override", "--since", "1")
		check(t, !(code != 0 || out != "[2] assistant (complete): hello\n" || stderr != ""), "read: %d %q %q", code, out, stderr)
	}
}
func TestChatMissingTokenFile(t *testing.T) {
	path := setup(t, func(http.ResponseWriter, *http.Request) { t.Error("unexpected request") })
	path += "-missing"
	t.Setenv("POLYMUX_TOKEN_FILE", path)
	code, _, stderr := invoke(t, "read")
	check(t, !(code != 1 || stderr != "polymux-chat: device token file not readable: "+path+"\n"), "got %d %q", code, stderr)
}
func TestChatNeverPrintsToken(t *testing.T) {
	for _, status := range []int{200, 302, 401, 500} {
		setup(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			fmt.Fprintf(w, `[{"seq":2,"role":"assistant","parts":[{"text":%q}]}]`, strings.Repeat("x", 280)+secret+secret)
		})
		code, out, stderr := invoke(t, "read")
		check(t, !(status == 200 && (code != 0 || !strings.Contains(out, "[redacted]"))), "missing redacted message")
		check(t, !(status != 200 && (code != 1 || !strings.Contains(stderr, fmt.Sprintf("HTTP %d", status)))), "missing HTTP error")
	}
}
func TestChatWaitCompletesAndTimesOut(t *testing.T) {
	for _, status := range []string{"complete", "completed", "done", "error", "pending", "empty"} {
		calls := 0
		setup(t, func(w http.ResponseWriter, r *http.Request) {
			calls++
			text, s := "reply", status
			if status == "empty" {
				text, s = "", "complete"
			}
			if calls == 1 {
				s = "pending"
			}
			fmt.Fprintf(w, `[{"seq":2,"role":"assistant","status":%q,"parts":[{"text":%q}]}]`, s, text)
		})
		code, _, stderr := invoke(t, "wait", "--since", "1")
		timeout := status == "pending" || status == "empty"
		check(t, !(timeout && (code != 1 || stderr != "polymux-chat: timeout\n" || calls != 3)), "timeout: %d %q calls=%d", code, stderr, calls)
		check(t, !(!timeout && (code != 0 || stderr != "" || calls != 2)), "completion: %d %q calls=%d", code, stderr, calls)
	}
}
