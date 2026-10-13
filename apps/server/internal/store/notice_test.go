package store

import (
	"database/sql"
	"errors"
	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"strings"
	"testing"
)

func TestNoticesCommitDeduplicateAndRecoverPush(t *testing.T) {
	t.Parallel()
	s := runStore(t)
	device := contract.PushDevice{ID: "fixture-installation", Token: strings.Repeat("ab", 32), Environment: "sandbox", Server: "http://server.test:7337", Enabled: true}
	if err := s.RegisterPush(t.Context(), device); err != nil {
		t.Fatal(err)
	}
	text := "Do not expose this message in the notification payload"
	m := contract.Message{ID: "reply", ThreadID: "a", AgentID: ptr("a"), Role: "assistant", Status: "streaming", CreatedAt: Now(), Parts: []contract.Part{{Kind: "text", Text: &text}}}
	if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.start"}, &m); err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	page, err := s.Notices(t.Context(), &zero)
	if err != nil || len(page.Notices) != 0 {
		t.Fatal("streaming message notified")
	}
	m.Status = "done"
	for range 2 {
		if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.done"}, &m); err != nil {
			t.Fatal(err)
		}
	}
	page, err = s.Notices(t.Context(), &zero)
	if err != nil || len(page.Notices) != 1 || page.Cursor != page.Notices[0].Seq || page.Notices[0].Title != "Same" {
		t.Fatalf("page %+v %v", page, err)
	}
	baseline, err := s.Notices(t.Context(), nil)
	if err != nil || baseline.Cursor != page.Cursor || len(baseline.Notices) != 0 {
		t.Fatal("first connect replays historical notifications")
	}
	push, err := s.ClaimPush(t.Context())
	if err != nil || push.Device.Token != device.Token {
		t.Fatal(err)
	}
	if err := s.Recover(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimPush(t.Context()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("ambiguous push replayed")
	}
	var state string
	if err := s.DB.QueryRowContext(t.Context(), `SELECT state FROM push_queue`).Scan(&state); err != nil || state != "unknown" {
		t.Fatalf("outcome %s %v", state, err)
	}
}

func TestFailedPushRetriesWithBackoffAndThenStops(t *testing.T) {
	s := runStore(t)
	device := contract.PushDevice{ID: "fixture-installation", Token: strings.Repeat("ab", 32), Environment: "sandbox", Server: "http://server.test:7337", Enabled: true}
	if err := s.RegisterPush(t.Context(), device); err != nil {
		t.Fatal(err)
	}
	text := "Fixture notice"
	m := contract.Message{ID: "reply", ThreadID: "a", AgentID: ptr("a"), Role: "assistant", Status: "done", CreatedAt: Now(), Parts: []contract.Part{{Kind: "text", Text: &text}}}
	if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.start"}, &m); err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= PushAttempts; attempt++ {
		push, err := s.ClaimPush(t.Context())
		if err != nil {
			t.Fatalf("attempt %d not claimable: %v", attempt, err)
		}
		if err := s.FinishPush(t.Context(), push, PushResult{State: "failed"}); err != nil {
			t.Fatal(err)
		}
		if attempt < PushAttempts {
			if _, err := s.ClaimPush(t.Context()); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("attempt %d retried before its backoff", attempt)
			}
			if _, err := s.DB.ExecContext(t.Context(), `UPDATE push_queue SET retry_at=NULL`); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := s.ClaimPush(t.Context()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("exhausted push retried again")
	}
	var state string
	if err := s.DB.QueryRowContext(t.Context(), `SELECT state FROM push_queue`).Scan(&state); err != nil || state != "failed" {
		t.Fatalf("terminal state %q %v", state, err)
	}
}

func TestPushRetriesOnce(t *testing.T) {
	s := runStore(t)
	device := contract.PushDevice{ID: "fixture-installation", Token: strings.Repeat("ab", 32), Environment: "sandbox", Server: "http://server.test:7337", Enabled: true}
	if err := s.RegisterPush(t.Context(), device); err != nil {
		t.Fatal(err)
	}
	text := "Fixture notice"
	m := contract.Message{ID: "once", ThreadID: "a", AgentID: ptr("a"), Role: "assistant", Status: "done", CreatedAt: Now(), Parts: []contract.Part{{Kind: "text", Text: &text}}}
	if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.start"}, &m); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		push, err := s.ClaimPush(t.Context())
		if err != nil {
			t.Fatalf("retry missing: %v", err)
		}
		if err := s.FinishPush(t.Context(), push, PushResult{State: "failed"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.DB.ExecContext(t.Context(), `UPDATE push_queue SET retry_at=NULL`); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ClaimPush(t.Context()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("push retried more than once")
	}
}

func TestPruneNoticesDropsSettledRowsOnly(t *testing.T) {
	s := runStore(t)
	device := contract.PushDevice{ID: "fixture-installation", Token: strings.Repeat("ab", 32), Environment: "sandbox", Server: "http://server.test:7337", Enabled: true}
	if err := s.RegisterPush(t.Context(), device); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"old", "new"} {
		text := "Fixture notice"
		m := contract.Message{ID: id, ThreadID: "a", AgentID: ptr("a"), Role: "assistant", Status: "done", CreatedAt: Now(), Parts: []contract.Part{{Kind: "text", Text: &text}}}
		if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.start"}, &m); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.PruneNotices(t.Context()); err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	page, err := s.Notices(t.Context(), &zero)
	if err != nil || len(page.Notices) != 2 {
		t.Fatalf("recent feed pruned: %+v %v", page, err)
	}
	// Age one notice past retention and settle both rows.
	if _, err := s.DB.ExecContext(t.Context(), `UPDATE notices SET data=json_set(data,'$.createdAt','2000-01-01T00:00:00Z') WHERE seq=(SELECT min(seq) FROM notices)`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(t.Context(), `UPDATE push_queue SET state='sent'`); err != nil {
		t.Fatal(err)
	}
	if err := s.PruneNotices(t.Context()); err != nil {
		t.Fatal(err)
	}
	page, err = s.Notices(t.Context(), &zero)
	if err != nil || len(page.Notices) != 1 || page.Notices[0].MessageID != "new" {
		t.Fatalf("retention wrong: %+v %v", page, err)
	}
	var queued int
	if err := s.DB.QueryRowContext(t.Context(), `SELECT count(*) FROM push_queue`).Scan(&queued); err != nil || queued != 1 {
		t.Fatalf("settled rows %d %v", queued, err)
	}
}

func TestNoticesRejectDevicesAndQuietReplies(t *testing.T) {
	t.Parallel()
	s := runStore(t)
	for _, environment := range []string{"", "unknown"} {
		if err := s.RegisterPush(t.Context(), contract.PushDevice{ID: "installation-valid", Environment: environment, Enabled: true, Token: "invalid"}); !errors.Is(err, ErrDevice) {
			t.Fatal("invalid device accepted")
		}
	}
	m := contract.Message{ID: "quiet", ThreadID: "a", Role: "assistant", Status: "done", Parts: []contract.Part{}}
	if _, err := s.Append(t.Context(), contract.Event{ConversationID: "a", Type: "message.done"}, &m); err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	page, err := s.Notices(t.Context(), &zero)
	if err != nil || len(page.Notices) != 0 {
		t.Fatal("quiet reply notified")
	}
}
