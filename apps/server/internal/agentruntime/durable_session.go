package agentruntime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/CarlvinceTan/polymux/apps/server/internal/contract"
	"github.com/MichaelKinsy/PiG/agent"
	"github.com/MichaelKinsy/PiG/ai"
	"github.com/MichaelKinsy/PiG/durable"
	"github.com/MichaelKinsy/PiG/durable/env"
	envnode "github.com/MichaelKinsy/PiG/durable/env/node"
	"github.com/MichaelKinsy/PiG/durable/harness"
	"github.com/MichaelKinsy/PiG/durable/tools"
	"github.com/MichaelKinsy/PiG/mcp"
)

// DurableRuntime runs Polymux conversations on PiG's durable harness instead of the coding
// agent. It satisfies the same factory shape, so the server swaps to it by construction.
type DurableRuntime struct {
	harness  harness.Harness
	registry harness.Registry
	model    string
	dir      string
	client   Client
	sessions sync.Map
}

// NewDurable opens a durable harness over the given storage. Conversations, generations,
// tools and usage are durable; Polymux's own session persistence stores the conversation id.
func NewDurable(ctx context.Context, dir, baseURL, model, key string, client Client, storage durable.Storage) (*DurableRuntime, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	registry := harness.CreateRegistry()
	opened, err := harness.OpenHarness(ctx, cacheHistory(storage), harness.HarnessOptions{
		Models: durableModels(baseURL, key, model, client),
		Settings: func() *harness.HarnessSettings {
			return &harness.HarnessSettings{Compaction: &harness.CompactionPolicyPatch{
				ReserveTokens: new(4096), KeepRecentTokens: new(4096), BackgroundTokens: new(0),
			}}
		},
		Registry: registry,
		Env: func(_ context.Context, target harness.EnvTarget) (env.ExecutionEnv, error) {
			cwd := dir
			if target.Cwd != nil && *target.Cwd != "" {
				cwd = *target.Cwd
			}
			return envnode.NewNodeExecutionEnv(envnode.NodeExecutionEnvOptions{Cwd: cwd}), nil
		},
	})
	if err != nil {
		return nil, err
	}
	return &DurableRuntime{harness: opened, registry: registry, model: model, dir: dir, client: client}, nil
}

// builtinTool maps a Polymux builtin name to its durable registration. Durable has no find or
// ls; bash covers both.
func builtinTool(name string) *durable.ToolRegistration {
	switch name {
	case "read":
		return tools.CreateReadTool()
	case "write":
		return tools.CreateWriteTool()
	case "edit":
		return tools.CreateEditTool()
	case "bash":
		return tools.CreateBashTool(nil)
	}
	return nil
}

func (r *DurableRuntime) Close() error {
	err := r.harness.Close(context.WithoutCancel(context.Background()))
	r.sessions.Range(func(key, _ any) bool {
		err = errors.Join(err, key.(*durableSession).Close())
		return true
	})
	return err
}

// Open resumes the conversation Polymux recorded, or starts one. An ephemeral definition never
// resumes, so a voice turn or an automatic review cannot inherit another turn's context.
func (r *DurableRuntime) Open(ctx context.Context, d Definition, path string) (Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	conversation, err := r.conversation(ctx, d, path)
	if err != nil {
		return nil, err
	}
	cwd := d.workingDir(filepath.Join(r.dir, d.Agent.ID))
	if err := os.MkdirAll(cwd, 0700); err != nil {
		return nil, err
	}
	servers := d.MCP
	if d.Intro {
		servers = nil
	}
	connected, clients, mcpErr := connectMCP(ctx, servers, cwd)
	session := &durableSession{conversation: conversation, definition: d, attachments: filepath.Join(r.dir, "attachments"), clients: clients, runtime: r, degraded: mcpErr != nil}
	opened := false
	defer func() {
		if !opened {
			_ = session.Close()
		}
	}()
	registration := d
	registration.ExtraTools = append(append([]agent.AgentTool{}, d.ExtraTools...), connected...)
	if d.TurnContext != nil {
		registration.TurnContext = func() (context.Context, bool) {
			return session.turnContext(conversation.Id(), ctx)
		}
	}
	tools := Tools(registration, conversation.Id())
	for _, name := range d.Tools {
		if registration := builtinTool(name); registration != nil {
			tools = append(tools, registration)
		}
	}
	var names []string
	for _, registration := range tools {
		names = append(names, registration.ToolSchema.Name)
	}
	prompt, err := buildPrompt(d, names, mcpErr != nil || d.Intro && len(d.MCP) > 0)
	if err != nil {
		return nil, err
	}
	change := harness.AgentChange{
		Instructions: harness.SetTo(prompt),
		Model:        harness.SetTo(durable.ModelRef{Provider: DurableProvider, ModelId: modelID(d, r.model)}),
		Cwd:          harness.SetTo(cwd),
	}
	// A tool must compose from an installed extension to be resolvable, and the change below
	// selects which of them this conversation offers. Each tool gets its own extension so a
	// later turn's install cannot replace an earlier one's.
	for _, registration := range tools {
		extension := &durable.Extension{Name: "polymux:" + strconv.FormatInt(int64(conversation.Id()), 10) + ":" + registration.ToolSchema.Name, Tools: []*durable.ToolRegistration{registration}}
		if err := r.registry.Install(extension); err != nil {
			return nil, err
		}
		session.extensions = append(session.extensions, extension)
	}
	// An explicit selection, even an empty one: a conversation without a filter would
	// otherwise inherit every tool ever installed.
	change.Tools = harness.SetTo(harness.ToolChange{Exact: true, List: tools})
	if hooks := session.hooks(); len(hooks) > 0 {
		extension := &durable.Extension{Name: "polymux:hooks:" + strconv.FormatInt(int64(conversation.Id()), 10), Hooks: hooks}
		if err := r.registry.Install(extension); err != nil {
			return nil, err
		}
		session.extensions = append(session.extensions, extension)
	}
	change.Extensions = harness.SetTo(harness.ExtensionChange{Exact: true, List: session.extensions})
	if err := conversation.Configure(ctx, change); err != nil {
		return nil, err
	}
	r.sessions.Store(session, struct{}{})
	opened = true
	return session, nil
}

func (r *DurableRuntime) conversation(ctx context.Context, d Definition, path string) (harness.Conversation, error) {
	if id, ok := parseDurablePath(path); ok && !d.Ephemeral {
		conversation, err := r.harness.Conversation(ctx, id)
		if err == nil && conversation != nil {
			return conversation, nil
		}
	}
	// Root is the reserved single root conversation, so each Polymux conversation needs its own.
	return r.harness.CreateConversation(ctx, harness.ConversationCreateOptions{
		Ownership: durable.ConversationOwnership{Kind: durable.ConversationOwnerless},
	})
}

// DurableProvider is the models-runtime provider ID Polymux registers its endpoint under.
const DurableProvider = "polymux"

// MaxRequestBytes is the observed request bound for compaction evals.
const MaxRequestBytes = 128 << 10

// durableModels registers Polymux's OpenAI-compatible endpoint with the durable models runtime.
func durableModels(baseURL, key, model string, client Client) *ai.Models {
	provider := ai.NewOpenAIProvider(ai.OpenAIConfig{BaseURL: baseURL, APIKey: key, Model: model, ProviderID: DurableProvider, ExtraHeaders: client.Headers})
	models := ai.CreateModels()
	models.SetProvider(&ai.ModelsProvider{
		ID: DurableProvider, Name: DurableProvider, BaseURL: baseURL,
		GetModels: func() ([]*ai.Model, error) {
			return []*ai.Model{{ID: model, Capabilities: ai.ModelCapabilities{ContextWindow: 16384}, ProviderMeta: ai.ProviderMetadata{ProviderID: DurableProvider, API: ai.APIOpenAICompletions, BaseURL: baseURL}}}, nil
		},
		Stream:       passthrough(provider),
		StreamSimple: passthrough(provider),
		Auth: ai.ProviderAuth{APIKey: &ai.APIKeyAuth{Name: "Polymux key", Resolve: func(context.Context, ai.APIKeyAuthInput) (*ai.AuthResult, error) {
			return &ai.AuthResult{Auth: ai.ModelAuth{APIKey: key}, Source: DurableProvider}, nil
		}}},
	})
	return models
}

// passthrough adapts an ai.Provider to the models runtime stream signature.
func passthrough(provider ai.Provider) ai.ModelsStreamFunction {
	return func(ctx context.Context, _ *ai.Model, transcript ai.TranscriptContext, opts ai.StreamOptions) (*ai.AssistantMessageEventStream, error) {
		return provider.Stream(ctx, transcript, opts)
	}
}

func modelID(d Definition, fallback string) string {
	if d.Agent.Model != "" {
		return d.Agent.Model
	}
	return fallback
}

// durableSession runs one Polymux conversation. The conversation id round-trips through Path,
// so Polymux's existing session persistence is the identity store.
type durableSession struct {
	conversation harness.Conversation
	definition   Definition
	attachments  string
	mu           sync.Mutex
	// emit is the current turn's delta sink; hooks report tool activity through it, and
	// Polymux's existing delta handling records effect receipts and tool parts from that.
	// It has its own lock because Send holds mu for the whole turn.
	emitMu sync.Mutex
	emit   func(Delta) error
	// park is set when BeforeTool requests Terminate; AfterTools aborts the in-flight turn.
	park       atomic.Bool
	clients    []*mcp.Client
	extensions []*durable.Extension
	runtime    *DurableRuntime
	degraded   bool
	closeOnce  sync.Once
	closeErr   error
}

// turnContext restores the context this conversation's tool calls and hooks run under.
// A definition without a resolver needs no restoration; another conversation is refused.
func (s *durableSession) turnContext(conversation durable.ConversationId, fallback context.Context) (context.Context, bool) {
	if conversation != s.conversation.Id() {
		return nil, false
	}
	if s.definition.TurnContext == nil {
		return fallback, true
	}
	return s.definition.TurnContext()
}

// report sends a delta for this turn when one is running.
func (s *durableSession) report(delta Delta) {
	s.emitMu.Lock()
	emit := s.emit
	s.emitMu.Unlock()
	if emit != nil {
		_ = emit(delta)
	}
}

// hooks bridge Polymux's tool gate and effect reporting to the durable tool task. Durable
// runs tools on its own line, so the gate must be reinstalled here or an unattended turn
// would bypass budgets, the automatic-turn tool gate and effect receipts.
func (s *durableSession) hooks() []durable.HookRegistration {
	if s.definition.BeforeTool == nil {
		return nil
	}
	return []durable.HookRegistration{
		{Task: "pi.tool", Handlers: &harness.ToolHooks{
			BeforeTool: func(ctx context.Context, call ai.ToolCall, api harness.HookApi) (*harness.BeforeToolResult, error) {
				restored, ok := s.turnContext(api.ConversationId(), ctx)
				if !ok {
					reason := ErrTurnState.Error()
					return &harness.BeforeToolResult{Block: &reason}, nil
				}
				raw, err := json.Marshal(call.Arguments)
				if err != nil {
					return nil, err
				}
				decision := s.definition.BeforeTool(restored, call.ID, call.Name, raw)
				if decision.Block {
					reason := decision.Reason
					if reason == "" {
						reason = "This call is not available in this turn."
					}
					// Durable BeforeToolResult has no Terminate; Abort ends the turn after tools settle.
					if decision.Terminate {
						s.park.Store(true)
					}
					return &harness.BeforeToolResult{Block: &reason}, nil
				}
				s.report(Delta{Kind: "tool.start", ToolID: call.ID, Tool: call.Name, Brief: toolSummary(call.Name, raw)})
				if len(decision.Args) == 0 {
					return nil, nil
				}
				arguments := durable.JsonObject{}
				if json.Unmarshal(decision.Args, &arguments) != nil {
					return nil, nil
				}
				return &harness.BeforeToolResult{Arguments: arguments}, nil
			},
			AfterTool: func(ctx context.Context, call ai.ToolCall, result durable.ToolExecutionResult, api harness.HookApi) (*durable.ToolExecutionResult, error) {
				if _, ok := s.turnContext(api.ConversationId(), ctx); !ok {
					return nil, nil
				}
				s.report(Delta{Kind: "tool.done", ToolID: call.ID, Tool: call.Name, Failed: result.IsError != nil && *result.IsError, Output: toolExcerpt(result.Content)})
				return nil, nil
			},
		}},
		harness.Hook(harness.GenerationTask, &harness.GenerationHooks{
			BeforeRequest: s.steerRequest,
			// Abort marks the generation so the scheduler ends it as unanswered. The error
			// stops finishToolRound from starting a successor request in the same turn.
			AfterTools: func(ctx context.Context, _ durable.EntryId, _ []durable.EntryId, _ harness.HookApi) error {
				if !s.park.Load() {
					return nil
				}
				_ = s.conversation.Abort(ctx, nil)
				return errApprovalPause
			},
		}),
	}
}

type steerKey struct{}

func WithSteers(ctx context.Context, drain func(context.Context, func([]contract.Message) error) error) context.Context {
	return context.WithValue(ctx, steerKey{}, drain)
}

func (s *durableSession) steerRequest(ctx context.Context, request harness.GenerationRequest, api harness.HookApi) (*harness.GenerationRequest, error) {
	restored, ok := s.turnContext(api.ConversationId(), ctx)
	if !ok {
		return nil, ErrTurnState
	}
	drain, _ := restored.Value(steerKey{}).(func(context.Context, func([]contract.Message) error) error)
	if drain == nil {
		return nil, nil
	}
	err := drain(restored, func(messages []contract.Message) error {
		added := []ai.Message{}
		_, err := s.conversation.Commit(ctx, func(tx durable.Tx) (any, error) {
			for _, message := range messages {
				content, err := s.content(message)
				if err != nil {
					return nil, err
				}
				user := ai.UserMessage{Content: content, Timestamp: time.Now().UnixMilli()}
				if _, err := durable.TxAppendEntry(tx, durable.UserEntry, api.ConversationId(), durable.TypedEntryDraft[durable.Never]{Model: []ai.Message{user}}); err != nil {
					return nil, err
				}
				added = append(added, user)
			}
			return nil, nil
		})
		if err == nil {
			request.Messages = append(request.Messages, added...)
		}
		return err
	})
	return &request, err
}

var errApprovalPause = errors.New("waiting for approval")

func (s *durableSession) Path() string { return durablePath(s.conversation.Id()) }
func (s *durableSession) Reusable() bool {
	return !s.degraded
}
func (s *durableSession) Abort(ctx context.Context) error { return s.conversation.Abort(ctx, nil) }

// BindTurn refreshes per-turn hooks so a reused session does not keep a canceled prior context.
func (s *durableSession) BindTurn(before agent.BeforeToolCallHook, turn func() (context.Context, bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.definition.BeforeTool = before
	s.definition.TurnContext = turn
}

// The conversation persists; its live clients and registrations are released.
func (s *durableSession) Close() error {
	s.closeOnce.Do(func() {
		s.closeErr = closeMCP(s.clients)
		if s.runtime != nil {
			for _, extension := range s.extensions {
				// A reopened conversation may have replaced this registration.
				if s.runtime.registry.Snapshot().Extension(extension.Name) == extension {
					s.runtime.registry.Uninstall(extension)
				}
			}
			s.extensions = nil
			s.runtime.sessions.Delete(s)
		}
	})
	return s.closeErr
}

func durablePath(id durable.ConversationId) string {
	return "durable:" + strconv.FormatInt(int64(id), 10)
}

func parseDurablePath(path string) (durable.ConversationId, bool) {
	raw, ok := strings.CutPrefix(path, "durable:")
	if !ok {
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return durable.ConversationId(id), true
}

// Send admits the turn and waits for its answer, streaming partial answers and tool calls.
func (s *durableSession) Send(ctx context.Context, m contract.Message, emit func(Delta) error) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emitMu.Lock()
	s.emit = emit
	s.emitMu.Unlock()
	defer func() {
		s.emitMu.Lock()
		s.emit = nil
		s.emitMu.Unlock()
	}()
	content, err := s.content(m)
	if err != nil {
		return Result{}, err
	}
	stop := s.stream(ctx, emit)
	defer stop()
	submission, err := s.conversation.Submit(ctx, durable.SubmissionDraft{Type: durable.SubmissionTypeInput, Content: content})
	if err != nil {
		return Result{}, err
	}
	if emit != nil {
		if err := emit(Delta{Kind: "submission", ToolID: strconv.FormatInt(int64(submission.Id()), 10)}); err != nil {
			return Result{}, err
		}
	}
	settled, err := submission.Wait(ctx)
	if err != nil {
		if s.park.Swap(false) {
			return Result{}, nil
		}
		return Result{}, err
	}
	return s.outcome(ctx, settled)
}

// Resume continues one submission. A placed submission is the crash window; any other
// queued message stays queued. Otherwise a new generation replays the stored context.
func (s *durableSession) Resume(ctx context.Context, submissionID int64, emit func(Delta) error) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emitMu.Lock()
	s.emit = emit
	s.emitMu.Unlock()
	defer func() {
		s.emitMu.Lock()
		s.emit = nil
		s.emitMu.Unlock()
	}()
	if s.runtime == nil {
		return Result{}, errors.New("no turn to resume")
	}
	stop := s.stream(ctx, emit)
	defer stop()
	if submission, ok := s.owned(ctx, submissionID); ok {
		settled, err := submission.Wait(ctx)
		if err != nil {
			return Result{}, err
		}
		return s.outcome(ctx, settled)
	}
	return s.replay(ctx)
}

func (s *durableSession) owned(ctx context.Context, id int64) (durable.Submission, bool) {
	if id == 0 || s.runtime == nil {
		return nil, false
	}
	submission, err := s.runtime.harness.Submission(ctx, durable.SubmissionId(id))
	if err != nil || submission == nil {
		return nil, false
	}
	record, err := submission.Status(ctx)
	if err != nil || record.ConversationId != s.conversation.Id() || record.Type != durable.SubmissionTypeInput {
		return nil, false
	}
	if record.Status != durable.SubmissionQueued && record.Status != durable.SubmissionPlaced {
		return nil, false
	}
	return submission, true
}

func (s *durableSession) replay(ctx context.Context) (Result, error) {
	conversation := s.conversation.Id()
	value, err := s.conversation.Commit(ctx, func(tx durable.Tx) (any, error) {
		return durable.CreateTask(tx, harness.GenerationTask, harness.GenerationInput{}, durable.TaskOptions{
			Ownership:      durable.TaskOwnership{Kind: durable.TaskOwnedByConversation},
			ConversationId: &conversation,
		})
	})
	if err != nil {
		return Result{}, err
	}
	taskID, ok := value.(durable.TaskId)
	if !ok {
		return Result{}, errors.New("no turn to resume")
	}
	settled, err := s.runtime.harness.WaitForTask(ctx, taskID)
	if err != nil {
		return Result{}, err
	}
	if settled.State.Outcome == nil || settled.State.Outcome.Status != durable.OutcomeCompleted {
		return Result{}, errors.New("resume did not finish")
	}
	view, err := s.conversation.Context(ctx)
	if err != nil {
		return Result{}, err
	}
	text := ""
	usage := contract.Usage{}
	for _, message := range view.Messages {
		assistant, ok := message.(ai.AssistantMessage)
		if !ok {
			continue
		}
		current := ""
		for _, block := range assistant.Content {
			if content, ok := block.(ai.TextContent); ok {
				current += content.Text
			}
		}
		if current == "" {
			continue
		}
		text = current
		usage = contract.Usage{InputTokens: int64(assistant.Usage.Input), OutputTokens: int64(assistant.Usage.Output)}
	}
	if text == "" {
		return Result{}, errors.New("resume did not finish")
	}
	return Result{Text: text, Usage: usage}, nil
}

func (s *durableSession) outcome(ctx context.Context, settled durable.SettledSubmissionRecord) (Result, error) {
	result := Result{}
	if settled.Answer != nil {
		text, usage, err := s.answer(ctx, *settled.Answer)
		if err != nil {
			return result, err
		}
		result.Text, result.Usage = text, usage
	}
	parked := s.park.Swap(false)
	switch settled.Status {
	case durable.SubmissionDone:
		return result, nil
	case durable.SubmissionUnanswered:
		if parked {
			return result, nil
		}
		return result, errors.New("the agent did not answer")
	default:
		if parked {
			return result, nil
		}
		return result, fmt.Errorf("turn ended as %s", settled.Status)
	}
}

// answer reads the text and token usage of the entry a settled submission answered with.
func (s *durableSession) answer(ctx context.Context, id durable.EntryId) (string, contract.Usage, error) {
	value, err := s.conversation.Commit(ctx, func(tx durable.Tx) (any, error) {
		entry, err := durable.TxEntry(tx, durable.AssistantEntry, id)
		if err != nil || entry == nil {
			return (*durable.EntryRecord)(nil), err
		}
		return &entry.EntryRecord, nil
	})
	if err != nil {
		return "", contract.Usage{}, err
	}
	entry, _ := value.(*durable.EntryRecord)
	if entry == nil {
		return "", contract.Usage{}, nil
	}
	text, usage := "", contract.Usage{}
	for _, message := range entry.Model {
		assistant, ok := message.(ai.AssistantMessage)
		if !ok {
			continue
		}
		for _, block := range assistant.Content {
			if content, ok := block.(ai.TextContent); ok {
				text += content.Text
			}
		}
		usage.InputTokens += int64(assistant.Usage.Input)
		usage.OutputTokens += int64(assistant.Usage.Output)
		if assistant.StopReason == ai.StopReasonError {
			return text, usage, fmt.Errorf("provider: %s", assistant.ErrorMessage)
		}
	}
	return text, usage, nil
}

// stream reports partial answers while the turn runs. Durable commits partial answers at its
// own pace, so deltas arrive in the sizes it records rather than per token. The returned
// function stops watching; a watch failure only costs the partials, never the turn.
func (s *durableSession) stream(ctx context.Context, emit func(Delta) error) func() {
	if emit == nil {
		return func() {}
	}
	watch, err := s.conversation.Watch(ctx)
	if err != nil {
		return func() {}
	}
	var mu sync.Mutex
	seen := ""
	started := false
	compactions := map[durable.EntryId]bool{}
	watch.Start(func(_ context.Context, view harness.ConversationView, _ []durable.Op) error {
		mu.Lock()
		defer mu.Unlock()
		for _, entry := range view.Entries {
			if entry.Kind == durable.CompactionEntry.Kind && !compactions[entry.Id] {
				compactions[entry.Id] = true
				if started {
					_ = emit(Delta{Kind: "context.compacted"})
				}
			}
		}
		if !started {
			started = true
			seen = lastAnswer(view)
			if err := emit(Delta{Kind: "generating"}); err != nil {
				return nil
			}
			return nil
		}
		text := lastAnswer(view)
		if text == "" || text == seen {
			return nil
		}
		if !strings.HasPrefix(text, seen) {
			seen = ""
		}
		delta := text[len(seen):]
		seen = text
		_ = emit(Delta{Text: delta})
		return nil
	})
	return func() {
		mu.Lock()
		defer mu.Unlock()
		_, _ = watch.Stop()
	}
}

// lastAnswer is the newest assistant text in a conversation revision.
func lastAnswer(view harness.ConversationView) string {
	text := ""
	for _, entry := range view.Entries {
		for _, message := range entry.Model {
			assistant, ok := message.(ai.AssistantMessage)
			if !ok {
				continue
			}
			current := ""
			for _, block := range assistant.Content {
				if content, ok := block.(ai.TextContent); ok {
					current += content.Text
				}
			}
			if current != "" {
				text = current
			}
		}
	}
	return text
}

// content builds the user content for one turn, matching the coding-agent session's shape.
func (s *durableSession) content(m contract.Message) (ai.UserContent, error) {
	blocks := ai.UserContentBlocks{}
	blocks = append(blocks, ai.TextContent{Text: "Current UTC time: " + time.Now().UTC().Format(time.RFC3339)})
	if m.Reply != nil {
		text, err := quoteText(m.Reply)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, ai.TextContent{Text: text})
	}
	for _, part := range m.Parts {
		if part.Text != nil {
			blocks = append(blocks, ai.TextContent{Text: *part.Text})
		}
		if part.Attachment == nil {
			continue
		}
		attachment := part.Attachment
		if attachment.Kind == "image" {
			if data, err := os.ReadFile(filepath.Join(s.attachments, attachment.ID)); err == nil {
				blocks = append(blocks, ai.ImageContent{MimeType: attachment.MimeType, Data: base64.StdEncoding.EncodeToString(data)})
				continue
			}
		}
		text := "Attachment: " + attachment.Name + " (" + attachment.MimeType + ")"
		text += "\nLocal file: " + filepath.Join(s.attachments, attachment.ID)
		if attachment.ExtractedText != nil {
			text += "\n" + *attachment.ExtractedText
		}
		blocks = append(blocks, ai.TextContent{Text: text})
	}
	if len(blocks) == 1 {
		blocks = append(blocks, ai.TextContent{Text: "Review the attached file."})
	}
	return blocks, nil
}
