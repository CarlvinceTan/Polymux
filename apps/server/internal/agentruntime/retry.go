package agentruntime

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/MichaelKinsy/PiG/ai"
)

const (
	retryMax   = 3
	retryCap   = 30 * time.Second
	retryCapMs = 30_000
)

// configureRetry is the PiG settings call. Tests replace it to simulate a failure.
var configureRetry = func() error {
	// PiG's transport retry stays off. Status retry below is the only provider retry,
	// so a 401 whose body says overloaded is not retried by message text.
	return ai.ConfigureProviderRetry(0, retryCapMs)
}

// EnableRetry applies provider retry settings. The caller logs a failure and continues.
func EnableRetry() error {
	return configureRetry()
}

// Clock waits between provider retries. Tests install one that does not sleep.
type Clock interface {
	Wait(ctx context.Context, d time.Duration) error
}

type wallClock struct{}

func (wallClock) Wait(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// clockBox keeps atomic.Value on one concrete type while the clock itself varies.
type clockBox struct{ c Clock }

var retryWait atomic.Value // clockBox

func retryClock() Clock {
	if box, ok := retryWait.Load().(clockBox); ok && box.c != nil {
		return box.c
	}
	return wallClock{}
}

func setRetryClock(c Clock) {
	if c == nil {
		c = wallClock{}
	}
	retryWait.Store(clockBox{c})
}

// retryNotices maps a durable conversation id to the turn's delta sink.
var retryNotices sync.Map

func bindRetry(id string, emit func(Delta) error) {
	if id == "" || emit == nil {
		retryNotices.Delete(id)
		return
	}
	retryNotices.Store(id, emit)
}

func notifyRetry(id string, attempt int) error {
	value, ok := retryNotices.Load(id)
	if !ok {
		return nil
	}
	emit, _ := value.(func(Delta) error)
	if emit == nil {
		return nil
	}
	return emit(Delta{Kind: "run.retrying", Attempt: attempt})
}

func conversationMarker(id string) string {
	return "polymux-conversation-id:" + id
}

// cutMarker removes the conversation marker from a provider request body.
// The marker correlates a retry notice; the model must not see it.
func cutMarker(body []byte) (string, []byte) {
	const prefix = "polymux-conversation-id:"
	raw := string(body)
	i := strings.LastIndex(raw, prefix)
	if i < 0 {
		return "", body
	}
	j := i + len(prefix)
	for j < len(raw) && raw[j] >= '0' && raw[j] <= '9' {
		j++
	}
	if j == i+len(prefix) {
		return "", body
	}
	start := i
	if strings.HasSuffix(raw[:i], `\n`) {
		start = i - 2
	}
	return raw[i+len(prefix) : j], []byte(raw[:start] + raw[j:])
}

func retryClient() *http.Client {
	return &http.Client{Transport: statusRetry{base: http.DefaultTransport}}
}

// statusRetry retries a provider request before any stream body is returned.
// Classification uses the HTTP status only.
type statusRetry struct {
	base http.RoundTripper
}

func (t statusRetry) RoundTrip(req *http.Request) (*http.Response, error) {
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	id := prepareRetry(req)
	for attempt := 0; ; attempt++ {
		if err := req.Context().Err(); err != nil {
			return nil, err
		}
		resp, err := base.RoundTrip(req)
		if ctxErr := req.Context().Err(); ctxErr != nil {
			drain(resp)
			return nil, ctxErr
		}
		if err != nil {
			if attempt >= retryMax || !rewindable(req) {
				return nil, err
			}
			if waitErr := waitRetry(req.Context(), id, attempt+1, 0); waitErr != nil {
				return nil, waitErr
			}
			if rewindErr := rewind(req); rewindErr != nil {
				return nil, rewindErr
			}
			continue
		}
		// A response body is stream output. Returning it means a later disconnect is not retried.
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return resp, nil
		}
		if attempt >= retryMax || !retryableStatus(resp.StatusCode) {
			return resp, nil
		}
		delay := retryAfter(resp.Header)
		drain(resp)
		if waitErr := waitRetry(req.Context(), id, attempt+1, delay); waitErr != nil {
			return nil, waitErr
		}
		if rewindErr := rewind(req); rewindErr != nil {
			return nil, rewindErr
		}
	}
}

func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusConflict || status == http.StatusTooManyRequests || status >= 500
}

func retryAfter(header http.Header) time.Duration {
	if v := header.Get("Retry-After-Ms"); v != "" {
		if ms, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && ms >= 0 {
			return time.Duration(ms * float64(time.Millisecond))
		}
	}
	if v := strings.TrimSpace(header.Get("Retry-After")); v != "" {
		if seconds, err := strconv.ParseFloat(v, 64); err == nil && seconds >= 0 {
			return time.Duration(seconds * float64(time.Second))
		}
		if when, err := http.ParseTime(v); err == nil {
			if d := time.Until(when); d > 0 {
				return d
			}
			return 0
		}
	}
	return 0
}

func capDelay(d time.Duration) time.Duration {
	if d > retryCap {
		return retryCap
	}
	if d < 0 {
		return 0
	}
	return d
}

func waitRetry(ctx context.Context, id string, attempt int, delay time.Duration) error {
	if err := notifyRetry(id, attempt); err != nil {
		return err
	}
	return retryClock().Wait(ctx, capDelay(delay))
}

func prepareRetry(req *http.Request) string {
	if req.Body == nil {
		return ""
	}
	data, err := io.ReadAll(req.Body)
	_ = req.Body.Close()
	if err != nil {
		req.Body = io.NopCloser(bytes.NewReader(nil))
		req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(nil)), nil }
		req.ContentLength = 0
		return ""
	}
	id, cleaned := cutMarker(data)
	req.Body = io.NopCloser(bytes.NewReader(cleaned))
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(bytes.Clone(cleaned))), nil
	}
	req.ContentLength = int64(len(cleaned))
	req.Header.Set("Content-Length", strconv.Itoa(len(cleaned)))
	return id
}

func rewindable(req *http.Request) bool {
	return req.Body == nil || req.GetBody != nil
}

func rewind(req *http.Request) error {
	if req.Body == nil {
		return nil
	}
	if req.GetBody == nil {
		return io.ErrUnexpectedEOF
	}
	body, err := req.GetBody()
	if err != nil {
		return err
	}
	req.Body = body
	return nil
}

func drain(resp *http.Response) {
	if resp == nil || resp.Body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
}
