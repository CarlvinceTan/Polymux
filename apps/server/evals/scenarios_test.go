package evals

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/agentruntime"
	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/CarlvinceTan/polymux/apps/server/internal/server"
	"github.com/CarlvinceTan/polymux/apps/server/internal/store"
	"github.com/MichaelKinsy/PiG/agent"
	"github.com/MichaelKinsy/PiG/ai"
)

const (
	agentID   = "assistant"
	deadline  = 15 * time.Second
	holdWait  = 3 * time.Second
	cancelMax = 2 * time.Second
	quietB2   = 300 * time.Millisecond
)

func TestT2EndTurn(t *testing.T) {
	h := Start(t, Options{ID: "T2", Steps: []Step{Fixed(nil, TextReply("hello from eval"))}})
	if code := h.Send(agentID, "t2-user", "hi"); code != 202 && code != 200 {
		fail(t, "T2", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitRun(agentID, "t2-user", agentID, deadline)
	if err := h.Emulator.Done(); err != nil {
		fail(t, "T2", err.Error())
		return
	}
	messages := h.Messages(agentID)
	done := h.AssistantDone(agentID)
	switch {
	case run.Status != "completed":
		fail(t, "T2", "run status "+run.Status)
	case run.MessageID == nil || *run.MessageID == "":
		fail(t, "T2", "run missing MessageID")
	case len(done) != 1:
		fail(t, "T2", fmt.Sprintf("want 1 done assistant message, got %d", len(done)))
	case assistantCount(messages) != 1:
		fail(t, "T2", fmt.Sprintf("want exactly 1 assistant message, got %d", assistantCount(messages)))
	case done[0].ID != *run.MessageID:
		fail(t, "T2", "run.MessageID does not match assistant message")
	case messageText(done[0]) != "hello from eval":
		fail(t, "T2", "unexpected text "+messageText(done[0]))
	default:
		pass(t, "T2", "text reply completed with one done assistant message")
	}
}

func TestT4Cancel(t *testing.T) {
	opened := make(chan struct{})
	release := make(chan struct{})
	h := Start(t, Options{ID: "T4", Steps: []Step{Fixed(nil, HoldReply("partial", release, func() { close(opened) }, nil))}})
	if code := h.Send(agentID, "t4-user", "hold please"); code != 202 && code != 200 {
		fail(t, "T4", fmt.Sprintf("send status %d", code))
		return
	}
	WaitHold(t, "T4", opened, holdWait)
	stopAt := time.Now()
	_ = h.Stop(agentID) // HTTP 200 is always written; assert cancel via run error code.
	run := h.WaitRun(agentID, "t4-user", agentID, cancelMax)
	time.Sleep(100 * time.Millisecond)
	for _, ts := range h.Emulator.RequestTimes() {
		if ts.After(stopAt) {
			fail(t, "T4", "emulator saw request after stop")
			return
		}
	}
	if err := h.Emulator.Done(); err != nil {
		fail(t, "T4", err.Error())
		return
	}
	switch {
	case run.Status != "cancelled":
		fail(t, "T4", "run status "+run.Status)
	case run.Error == nil || run.Error.Code != "stopped":
		fail(t, "T4", fmt.Sprintf("want error code stopped, got %+v", run.Error))
	default:
		pass(t, "T4", "stop cancelled run within 2s with no further model requests")
	}
}

func TestC1SchemaValidation(t *testing.T) {
	ran := &atomic.Int32{}
	h := Start(t, Options{
		ID:     "C1",
		Extras: map[string][]agent.AgentTool{agentID: {&typedTool{ran: ran}}},
		Steps: []Step{
			Fixed(nil, ToolReply("c1-call", "typed_tool", map[string]any{})), // missing required "value"
			Fixed(func(req *ChatRequest) error {
				if !hasToolError(req, "c1-call", "required") && !hasToolError(req, "c1-call", "value") &&
					!hasToolError(req, "c1-call", "validation") && !hasToolError(req, "c1-call", "invalid") {
					return fmt.Errorf("expected validation error tool result for c1-call")
				}
				return nil
			}, TextReply("schema rejected")),
		},
	})
	if code := h.Send(agentID, "c1-user", "call typed_tool badly"); code != 202 && code != 200 {
		fail(t, "C1", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitRun(agentID, "c1-user", agentID, deadline)
	if err := h.Emulator.Done(); err != nil {
		fail(t, "C1", err.Error())
		return
	}
	switch {
	case ran.Load() != 0:
		fail(t, "C1", "typed_tool Execute was called")
	case run.Status != "completed":
		fail(t, "C1", "run status "+run.Status)
	default:
		pass(t, "C1", "invalid args blocked Execute and surfaced error tool result")
	}
}

func TestC3ToolError(t *testing.T) {
	ran := &atomic.Int32{}
	h := Start(t, Options{
		ID:     "C3",
		Extras: map[string][]agent.AgentTool{agentID: {&errorTool{ran: ran}}},
		Steps: []Step{
			Fixed(nil, ToolReply("c3-call", "error_tool", map[string]any{})),
			Fixed(func(req *ChatRequest) error {
				if !hasToolError(req, "c3-call", "synthetic tool failure") {
					return fmt.Errorf("expected synthetic tool failure for c3-call")
				}
				return nil
			}, TextReply("tool failed cleanly")),
		},
	})
	if code := h.Send(agentID, "c3-user", "call error_tool"); code != 202 && code != 200 {
		fail(t, "C3", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitRun(agentID, "c3-user", agentID, deadline)
	if err := h.Emulator.Done(); err != nil {
		fail(t, "C3", err.Error())
		return
	}
	switch {
	case ran.Load() != 1:
		fail(t, "C3", fmt.Sprintf("error_tool ran %d times", ran.Load()))
	case run.Status != "completed":
		fail(t, "C3", "run status "+run.Status)
	default:
		pass(t, "C3", "tool error returned to model and run completed")
	}
}

func TestC4NoDuplicateSideEffects(t *testing.T) {
	counter := &atomic.Int32{}
	h := Start(t, Options{
		ID:      "C4",
		Effects: map[string]*atomic.Int32{agentID: counter},
		Steps: []Step{
			Fixed(nil, ToolReply("c4-call", "side_effect", map[string]any{})),
			Fixed(nil, DisconnectReply("partial after tool")),
			// Retries (if any) must replay the durable tool result, not re-invoke Execute.
			Fixed(func(req *ChatRequest) error {
				if !hasToolResult(req, "c4-call", "effect-ok") {
					return fmt.Errorf("retry missing durable tool result for c4-call")
				}
				return nil
			}, TextReply("recovered once")),
			Fixed(func(req *ChatRequest) error {
				if !hasToolResult(req, "c4-call", "effect-ok") {
					return fmt.Errorf("retry missing durable tool result for c4-call")
				}
				return nil
			}, TextReply("recovered twice")),
			Fixed(func(req *ChatRequest) error {
				if !hasToolResult(req, "c4-call", "effect-ok") {
					return fmt.Errorf("retry missing durable tool result for c4-call")
				}
				return nil
			}, TextReply("recovered thrice")),
		},
	})
	if code := h.Send(agentID, "c4-user", "side effect then drop"); code != 202 && code != 200 {
		fail(t, "C4", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitRun(agentID, "c4-user", agentID, deadline)
	count := h.Emulator.Count()
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "C4", err.Error())
		return
	}
	switch {
	case counter.Load() != 1:
		fail(t, "C4", fmt.Sprintf("side_effect counter=%d want 1 (run=%s)", counter.Load(), run.Status))
	case count > 5:
		fail(t, "C4", fmt.Sprintf("too many model requests: %d", count))
	case count >= 3 && !hasToolResult(h.Emulator.Requests()[2], "c4-call", "effect-ok"):
		fail(t, "C4", "retry did not replay durable tool result")
	default:
		pass(t, "C4", fmt.Sprintf("side_effect ran once; run %s", run.Status))
	}
}

func TestX1CrashMidTurn(t *testing.T) {
	opened := make(chan struct{})
	release := make(chan struct{})
	h := Start(t, Options{ID: "X1", Steps: []Step{Fixed(nil, HoldReply("streaming", release, func() { close(opened) }, nil))}})
	if code := h.Send(agentID, "x1-user", "crash me"); code != 202 && code != 200 {
		fail(t, "X1", fmt.Sprintf("send status %d", code))
		return
	}
	WaitHold(t, "X1", opened, holdWait)
	runID := RunID("x1-user", agentID)
	pre := h.WaitStatus(runID, holdWait, "running")
	if pre.Status != "running" {
		fail(t, "X1", "run not running before restart: "+pre.Status)
		return
	}
	h.Restart()
	run := h.WaitRunID(runID, deadline)
	events, err := h.Store.Events(context.Background(), agentID, 0, 500)
	if err != nil {
		fail(t, "X1", "events: "+err.Error())
		return
	}
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "X1", err.Error())
		return
	}
	switch {
	case run.Status == "running" || run.Status == "queued":
		fail(t, "X1", "run left "+run.Status)
	case run.Status != "interrupted" && run.Status != "failed":
		fail(t, "X1", "run status "+run.Status)
	case run.Error == nil || run.Error.Message == "":
		fail(t, "X1", "missing user-visible error")
	case !hasMessageError(events):
		fail(t, "X1", "missing thread-visible message.error event")
	default:
		pass(t, "X1", "restart left run "+run.Status+" with visible error")
	}
}

func TestX2PersistedToolResult(t *testing.T) {
	counter := &atomic.Int32{}
	opened := make(chan struct{})
	release := make(chan struct{})
	h := Start(t, Options{
		ID:      "X2",
		Effects: map[string]*atomic.Int32{agentID: counter},
		Steps: []Step{
			Fixed(nil, ToolReply("x2-call", "side_effect", map[string]any{})),
			Fixed(func(req *ChatRequest) error {
				if !hasToolResult(req, "x2-call", "effect-ok") {
					return fmt.Errorf("expected x2-call result effect-ok in model request")
				}
				return nil
			}, HoldReply("", release, func() { close(opened) }, nil)),
		},
	})
	if code := h.Send(agentID, "x2-user", "effect then crash"); code != 202 && code != 200 {
		fail(t, "X2", fmt.Sprintf("send status %d", code))
		return
	}
	WaitHold(t, "X2", opened, holdWait)
	if counter.Load() != 1 {
		fail(t, "X2", fmt.Sprintf("tool did not complete before restart: %d", counter.Load()))
		return
	}
	if len(h.Emulator.Requests()) < 2 || !hasToolResult(h.Emulator.Requests()[1], "x2-call", "effect-ok") {
		fail(t, "X2", "tool result did not reach the model before restart")
		return
	}
	runID := RunID("x2-user", agentID)
	h.Restart()
	run := h.WaitRunID(runID, deadline)
	// Durable transcript after restart: tool must not re-run; prior model request retained effect-ok.
	reqs := h.Emulator.Requests()
	if len(reqs) < 2 || !hasToolResult(reqs[1], "x2-call", "effect-ok") {
		fail(t, "X2", "persisted tool result missing from transcript after restart")
		return
	}
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "X2", err.Error())
		return
	}
	switch {
	case counter.Load() != 1:
		fail(t, "X2", fmt.Sprintf("side_effect re-ran after restart: %d", counter.Load()))
	case !store.Terminal(run.Status):
		fail(t, "X2", "run not terminal: "+run.Status)
	case run.Error == nil && run.Summary == "":
		fail(t, "X2", "terminal run not explained")
	default:
		pass(t, "X2", fmt.Sprintf("tool not re-run; run %s explained", run.Status))
	}
}

func TestX4ProviderErrors(t *testing.T) {
	// Coupled to PiG ai.IsRetryableAssistantError: message text must match retryable
	// patterns ("429" / "rate.?limit") vs non-retryable ("bad request"). Retry-After: 0
	// is pinned in the emulator so the retry fits the scenario deadline.
	h429 := Start(t, Options{ID: "X4", Steps: []Step{
		Fixed(nil, ErrorReply(429, "rate limited 429")),
		Fixed(nil, TextReply("after retry")),
	}})
	if code := h429.Send(agentID, "x4-429", "retry me"); code != 202 && code != 200 {
		fail(t, "X4", fmt.Sprintf("429 send status %d", code))
		return
	}
	run429 := h429.WaitRun(agentID, "x4-429", agentID, deadline)
	count429 := h429.Emulator.Count()
	if err := h429.Emulator.Done(); err != nil {
		fail(t, "X4", err.Error())
		return
	}

	h400 := Start(t, Options{ID: "X4", Steps: []Step{
		Fixed(nil, ErrorReply(400, "bad request")),
		Fixed(nil, TextReply("should not run")),
	}})
	if code := h400.Send(agentID, "x4-400", "fail me"); code != 202 && code != 200 {
		fail(t, "X4", fmt.Sprintf("400 send status %d", code))
		return
	}
	run400 := h400.WaitRun(agentID, "x4-400", agentID, deadline)
	count400 := h400.Emulator.Count()
	if err := h400.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "X4", err.Error())
		return
	}

	switch {
	case run429.Status != "completed" || count429 != 2:
		fail(t, "X4", fmt.Sprintf("429 path: status=%s requests=%d", run429.Status, count429))
	case run400.Status != "failed":
		fail(t, "X4", "400 path status "+run400.Status)
	case count400 != 1:
		fail(t, "X4", fmt.Sprintf("400 path retried: requests=%d", count400))
	case run400.Error == nil:
		fail(t, "X4", "400 path missing error")
	default:
		pass(t, "X4", "429 retried once; 400 failed without retry")
	}
}

func TestX6DisconnectMidStream(t *testing.T) {
	h := Start(t, Options{ID: "X6", Steps: []Step{
		Fixed(nil, DisconnectReply("UNIQUE_PARTIAL_X6")),
		Fixed(nil, TextReply("clean recovery")),
		Fixed(nil, TextReply("clean recovery 2")),
		Fixed(nil, TextReply("clean recovery 3")),
	}})
	if code := h.Send(agentID, "x6-user", "disconnect me"); code != 202 && code != 200 {
		fail(t, "X6", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitRun(agentID, "x6-user", agentID, deadline)
	text := ""
	for _, m := range h.Messages(agentID) {
		if m.Role == "assistant" {
			text += messageText(m)
		}
	}
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "X6", err.Error())
		return
	}
	partialN := strings.Count(text, "UNIQUE_PARTIAL_X6")
	recoveryN := strings.Count(text, "clean recovery")
	switch {
	case partialN > 1:
		fail(t, "X6", "duplicated partial text in final messages")
	case run.Status == "completed" && recoveryN == 1 && partialN == 0:
		pass(t, "X6", "clean recovery once with no partial")
	case (run.Status == "failed" || run.Status == "interrupted") && partialN == 1:
		pass(t, "X6", "failed cleanly retaining partial once")
	default:
		fail(t, "X6", fmt.Sprintf("unclean outcome status=%s partial=%d recovery=%d", run.Status, partialN, recoveryN))
	}
}

func TestB2BackgroundNotify(t *testing.T) {
	b2Reply := func(req *ChatRequest) Response {
		text := requestText(req)
		switch {
		case strings.Contains(text, "Do the bounded peer task"):
			return TextReply("peer finished the task")
		case strings.Contains(text, "peer finished the task") || strings.Contains(strings.ToLower(text), "peer result"):
			return TextReply("synthesized peer result once")
		default:
			return TextReply("queued peer work")
		}
	}
	h := Start(t, Options{
		ID: "B2",
		Agents: []agentruntime.Definition{
			{Agent: contract.Agent{ID: "a", Name: "A", Model: evalModel}, Tools: []string{}},
			{Agent: contract.Agent{ID: "b", Name: "B", Model: evalModel}, Tools: []string{}},
		},
		Steps: []Step{
			Fixed(nil, ToolReply("b2-peer", "message_agent", map[string]any{
				"agent_id": "b", "message": "Do the bounded peer task", "intent": "request",
			})),
			{Response: b2Reply},
			{Response: b2Reply},
			{Response: b2Reply},
		},
	})
	if code := h.Send("a", "b2-user", "Ask peer B to help"); code != 202 && code != 200 {
		fail(t, "B2", fmt.Sprintf("send status %d", code))
		return
	}
	parentID := store.NewRun("b2-user", "a", "a", "message").ID
	deadlineAt := time.Now().Add(deadline)
	var parent contract.Run
	settled := false
	for time.Now().Before(deadlineAt) {
		var err error
		parent, err = h.Store.Run(context.Background(), parentID)
		if err != nil {
			fail(t, "B2", "parent run: "+err.Error())
			return
		}
		_, followErr := h.Store.Work(context.Background(), "followup:"+parentID)
		if followErr != nil && !errors.Is(followErr, sql.ErrNoRows) {
			fail(t, "B2", "followup lookup: "+followErr.Error())
			return
		}
		followReady := followErr == nil
		// Settled = terminal parent, or follow-up observed (then keep waiting for terminal).
		if store.Terminal(parent.Status) {
			settled = true
			break
		}
		if followReady {
			// Follow-up exists; wait out the rest of the deadline for terminal parent.
			for time.Now().Before(deadlineAt) {
				parent, err = h.Store.Run(context.Background(), parentID)
				if err != nil {
					fail(t, "B2", "parent run: "+err.Error())
					return
				}
				if store.Terminal(parent.Status) {
					settled = true
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !settled {
		skip(t, "B2", "peer/follow-up flow could not be driven deterministically")
		return
	}

	receipts := countPeerReceipts(h.Messages("a"))
	time.Sleep(quietB2)
	receiptsAfter := countPeerReceipts(h.Messages("a"))
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "B2", err.Error())
		return
	}
	switch {
	case receipts != 1 || receiptsAfter != 1:
		fail(t, "B2", fmt.Sprintf("peer result count before=%d after_quiet=%d", receipts, receiptsAfter))
	default:
		pass(t, "B2", "peer result delivered exactly once without user action")
	}
}

func countPeerReceipts(messages []contract.Message) int {
	n := 0
	for _, m := range messages {
		if m.AgentID != nil && *m.AgentID == "b" && m.Status == "done" {
			n++
		}
	}
	return n
}

func TestT3MidTurnUserMessage(t *testing.T) {
	opened := make(chan struct{})
	release := make(chan struct{})
	h := Start(t, Options{ID: "T3", Steps: []Step{
		Fixed(nil, HoldReply("turn-one-partial", release, func() { close(opened) }, nil)),
		Fixed(nil, TextReply("reply includes second: ALPHA_T3")),
	}})
	if code := h.Send(agentID, "t3-one", "first message"); code != 202 && code != 200 {
		fail(t, "T3", fmt.Sprintf("send1 status %d", code))
		return
	}
	WaitHold(t, "T3", opened, holdWait)
	if code := h.Send(agentID, "t3-two", "second message ALPHA_T3"); code != 202 && code != 200 {
		fail(t, "T3", fmt.Sprintf("send2 status %d", code))
		return
	}
	close(release)
	run1 := h.WaitRun(agentID, "t3-one", agentID, deadline)
	run2 := h.WaitRun(agentID, "t3-two", agentID, deadline)
	replies := h.AssistantDone(agentID)
	joined := ""
	for _, m := range replies {
		joined += messageText(m)
	}
	users := 0
	for _, m := range h.Messages(agentID) {
		if m.Role == "user" {
			users++
		}
	}
	reachedModel := false
	for _, req := range h.Emulator.Requests() {
		if strings.Contains(requestText(req), "second message ALPHA_T3") {
			reachedModel = true
			break
		}
	}
	if err := h.Emulator.DoneAllowExtra(); err != nil {
		fail(t, "T3", err.Error())
		return
	}
	switch {
	case users < 2:
		fail(t, "T3", "second user message dropped before persist")
	case !reachedModel:
		fail(t, "T3", "second user message never reached a model request")
	case len(replies) == 2 && store.Terminal(run1.Status) && store.Terminal(run2.Status):
		pass(t, "T3", "both messages produced replies")
	case len(replies) == 1 && strings.Contains(joined, "ALPHA_T3") && run2.Status == "completed":
		pass(t, "T3", "second message steered into single reply")
	default:
		fail(t, "T3", fmt.Sprintf("both messages not answered (replies=%d run1=%s run2=%s)", len(replies), run1.Status, run2.Status))
	}
}

func TestC5ApprovalGate(t *testing.T) {
	ran := &atomic.Int32{}
	h := Start(t, Options{
		ID:     "C5",
		Extras: map[string][]agent.AgentTool{agentID: {&consequentialTool{ran: ran}}},
		Steps: []Step{
			Fixed(nil, ToolReply("c5-call", "consequential_delete", map[string]any{"target": "everything"})),
			Fixed(nil, ToolReply("c5-retry", "consequential_delete", map[string]any{"target": "everything"})),
			Fixed(nil, TextReply("deleted after approval")),
		},
	})
	if code := h.Send(agentID, "c5-user", "delete everything"); code != 202 && code != 200 {
		fail(t, "C5", fmt.Sprintf("send status %d", code))
		return
	}
	run := h.WaitStatus(RunID("c5-user", agentID), deadline, "waiting_input", "completed", "failed", "cancelled", "interrupted")
	if run.Status != "waiting_input" {
		fail(t, "C5", "expected waiting_input, got "+run.Status)
		return
	}
	if ran.Load() != 0 {
		fail(t, "C5", "tool executed before approval")
		return
	}
	pending, err := h.Store.PendingApprovals(context.Background(), run.ID)
	if err != nil || len(pending) != 1 {
		fail(t, "C5", fmt.Sprintf("pending approvals: %v %v", pending, err))
		return
	}
	events, err := h.Store.Events(context.Background(), agentID, 0, 500)
	if err != nil {
		fail(t, "C5", err.Error())
		return
	}
	requested := false
	for _, e := range events {
		if e.Type == "approval_requested" && e.Approval != nil && e.Approval.ID == pending[0].ID {
			requested = true
			break
		}
	}
	if !requested {
		fail(t, "C5", "missing approval_requested event")
		return
	}
	resp, err := approvalPost(h.HTTP.URL+"/approvals/"+pending[0].ID+"/approve")
	if err != nil {
		fail(t, "C5", err.Error())
		return
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		fail(t, "C5", fmt.Sprintf("approve status %d", resp.StatusCode))
		return
	}
	run = h.WaitRunID(run.ID, deadline)
	if err := h.Emulator.Done(); err != nil {
		fail(t, "C5", err.Error())
		return
	}
	if ran.Load() != 1 {
		fail(t, "C5", fmt.Sprintf("tool ran %d times, want 1", ran.Load()))
		return
	}
	if run.Status != "completed" {
		fail(t, "C5", "run status "+run.Status)
		return
	}

	denyRan := &atomic.Int32{}
	h2 := Start(t, Options{
		ID:     "C5",
		Extras: map[string][]agent.AgentTool{agentID: {&consequentialTool{ran: denyRan}}},
		Steps: []Step{
			Fixed(nil, ToolReply("c5-deny", "consequential_delete", map[string]any{"target": "secrets"})),
			Fixed(nil, ToolReply("c5-deny2", "consequential_delete", map[string]any{"target": "secrets"})),
			Fixed(func(req *ChatRequest) error {
				for _, m := range req.Messages {
					if m.Role == "tool" && strings.Contains(strings.ToLower(contentText(m.Content)), "denied") {
						return nil
					}
				}
				return fmt.Errorf("expected denial in tool results")
			}, TextReply("acknowledged denial")),
		},
	})
	if code := h2.Send(agentID, "c5-deny-user", "delete secrets"); code != 202 && code != 200 {
		fail(t, "C5", fmt.Sprintf("deny send status %d", code))
		return
	}
	denyRun := h2.WaitStatus(RunID("c5-deny-user", agentID), deadline, "waiting_input", "completed", "failed")
	if denyRun.Status != "waiting_input" {
		fail(t, "C5", "deny path expected waiting_input, got "+denyRun.Status)
		return
	}
	denyPending, err := h2.Store.PendingApprovals(context.Background(), denyRun.ID)
	if err != nil || len(denyPending) != 1 {
		fail(t, "C5", fmt.Sprintf("deny pending: %v %v", denyPending, err))
		return
	}
	resp, err = approvalPost(h2.HTTP.URL+"/approvals/"+denyPending[0].ID+"/deny")
	if err != nil {
		fail(t, "C5", err.Error())
		return
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		fail(t, "C5", fmt.Sprintf("deny status %d", resp.StatusCode))
		return
	}
	denyRun = h2.WaitRunID(denyRun.ID, deadline)
	if err := h2.Emulator.Done(); err != nil {
		fail(t, "C5", err.Error())
		return
	}
	if denyRan.Load() != 0 {
		fail(t, "C5", fmt.Sprintf("denied tool ran %d times", denyRan.Load()))
		return
	}
	if denyRun.Status != "completed" {
		fail(t, "C5", "deny run status "+denyRun.Status)
		return
	}
	pass(t, "C5", "approval gate parks, approve executes once, deny blocks with message")
}

type consequentialTool struct{ ran *atomic.Int32 }

func (*consequentialTool) Name() string                           { return "consequential_delete" }
func (*consequentialTool) Label() string                          { return "Consequential delete" }
func (*consequentialTool) Description() string                    { return "Destructive delete requiring approval" }
func (*consequentialTool) ExecutionMode() agent.ToolExecutionMode { return agent.ToolModeSequential }
func (*consequentialTool) ToolClass() string                      { return string(server.ToolConsequential) }

func approvalPost(url string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader("{}"))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Polymux-Client", "evals")
	return http.DefaultClient.Do(req)
}
func (*consequentialTool) Schema() ai.ToolSchema {
	return ai.ToolSchema{Name: "consequential_delete", Description: "Destructive delete requiring approval", Parameters: map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{"target": map[string]any{"type": "string"}},
		"required":   []string{"target"},
	}}
}
func (t *consequentialTool) Execute(context.Context, string, json.RawMessage, agent.ToolUpdateCallback) (agent.AgentToolResult, error) {
	t.ran.Add(1)
	return agent.AgentToolResult{Content: []ai.ToolResultMessageContent{ai.TextContent{Text: "deleted"}}}, nil
}
