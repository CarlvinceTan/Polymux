package main

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type message struct {
	Seq    int64  `json:"seq"`
	Role   string `json:"role"`
	Status string `json:"status"`
	Parts  []struct {
		Text string `json:"text"`
	} `json:"parts"`
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, time.Now, time.Sleep)) }
func run(args []string, out, stderr io.Writer, now func() time.Time, sleep func(time.Duration)) int {
	thread, since := os.Getenv("POLYMUX_THREAD"), int64(0)
	var positional []string
	hasSince := false
	usage := func() int {
		fmt.Fprintln(stderr, "polymux-chat: usage: polymux-chat [--thread ID] send TEXT | read [--since SEQ] | wait --since SEQ")
		return 2
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--thread" || arg == "--since" {
			i++
			if i == len(args) {
				return usage()
			}
			if arg == "--thread" {
				thread = args[i]
			} else {
				value, err := strconv.ParseInt(args[i], 10, 64)
				if err != nil || value < 0 {
					return usage()
				}
				since, hasSince = value, true
			}
		} else {
			positional = append(positional, arg)
		}
	}
	if len(positional) == 0 {
		return usage()
	}
	cmd := positional[0]
	if (cmd == "send" && (len(positional) != 2 || hasSince)) || ((cmd == "read" || cmd == "wait") && len(positional) != 1) || (cmd == "wait" && !hasSince) || (cmd != "send" && cmd != "read" && cmd != "wait") {
		return usage()
	}
	home, _ := os.UserHomeDir()
	tokenFile := env("POLYMUX_TOKEN_FILE", filepath.Join(home, ".polymux/data/devices/local-token"))
	raw, err := os.ReadFile(tokenFile)
	token := strings.Trim(string(raw), "\r\n")
	clean := func(s string) string {
		if token != "" {
			return strings.ReplaceAll(s, token, "[redacted]")
		}
		return s
	}
	fail := func(s string) int { fmt.Fprintln(stderr, "polymux-chat: "+clean(s)); return 1 }
	if err != nil {
		return fail("device token file not readable: " + tokenFile)
	}
	if thread == "" {
		return fail("thread required (set POLYMUX_THREAD or --thread ID)")
	}
	api := env("POLYMUX_API", "http://127.0.0.1:7337")
	path := "/threads/" + url.PathEscape(thread) + "/messages"
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request := func(method string, payload []byte) ([]byte, error) {
		unreachable := fmt.Errorf("cannot reach %s (%s %s)", clean(api), method, clean(path))
		req, e := http.NewRequest(method, strings.TrimRight(api, "/")+path, bytes.NewReader(payload))
		if e != nil {
			return nil, unreachable
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, e := client.Do(req)
		if e != nil {
			return nil, unreachable
		}
		defer res.Body.Close()
		if res.StatusCode == 401 || res.StatusCode == 403 {
			return nil, fmt.Errorf("HTTP %d on %s %s: device token rejected (check %s / pairing)", res.StatusCode, method, clean(path), clean(tokenFile))
		}
		body, e := io.ReadAll(res.Body)
		if e != nil {
			return nil, unreachable
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			detail := clean(string(body))
			if len(detail) > 300 {
				detail = detail[:300]
			}
			return nil, fmt.Errorf("HTTP %d on %s %s: %s", res.StatusCode, method, clean(path), detail)
		}
		return body, nil
	}
	if cmd == "send" {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return fail("cannot generate message ID")
		}
		id[6], id[8] = (id[6]&15)|64, (id[8]&63)|128
		uuid := fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
		payload, _ := json.Marshal(map[string]any{"id": uuid, "text": positional[1], "attachmentIDs": []string{}})
		body, err := request(http.MethodPost, payload)
		if err != nil {
			return fail(err.Error())
		}
		var response struct {
			Message *message `json:"message"`
			Seq     int64    `json:"seq"`
		}
		if json.Unmarshal(body, &response) != nil {
			return fail("invalid JSON response")
		}
		if response.Message != nil {
			response.Seq = response.Message.Seq
		}
		fmt.Fprintf(out, "sent seq %d\n", response.Seq)
		return 0
	}
	wait, err := strconv.Atoi(env("WAIT_SECS", "1800"))
	if err != nil || wait < 0 {
		return fail("WAIT_SECS must be a non-negative integer")
	}
	deadline := now().Add(time.Duration(wait) * time.Second)
	for {
		body, err := request(http.MethodGet, nil)
		if err != nil {
			return fail(err.Error())
		}
		var messages []message
		if json.Unmarshal(body, &messages) != nil {
			var response struct {
				Messages []message `json:"messages"`
			}
			if json.Unmarshal(body, &response) != nil {
				return fail("invalid JSON response")
			}
			messages = response.Messages
		}
		done := false
		for _, m := range messages {
			if m.Seq <= since {
				continue
			}
			text := ""
			for _, p := range m.Parts {
				text += p.Text
			}
			fmt.Fprintln(out, clean(fmt.Sprintf("[%d] %s (%s): %s", m.Seq, m.Role, m.Status, text)))
			if m.Role == "assistant" && (m.Status == "error" || (text != "" && (m.Status == "complete" || m.Status == "completed" || m.Status == "done"))) {
				done = true
			}
		}
		if cmd == "read" || done {
			return 0
		}
		remaining := deadline.Sub(now())
		if remaining <= 0 {
			return fail("timeout")
		}
		sleep(min(10*time.Second, remaining))
	}
}
