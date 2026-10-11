package agentruntime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/MichaelKinsy/PiG/agent"
	"github.com/MichaelKinsy/PiG/durable"
)

// ErrTurnState reports a durable tool call that arrived without its turn state. Durable
// executes tools on its own task line, so a resumed call after a restart has no caller
// context; failing is safer than running without the run, scope and effect records.
var ErrTurnState = errors.New("turn state is unavailable; review this stage before retrying")

// ToolRegistration adapts a Luce tool to the durable harness. The definition's TurnContext
// restores the context values a tool expects, because the caller's own context does not
// reach a durable tool call.
func ToolRegistration(d Definition, tool agent.AgentTool, conversation durable.ConversationId) *durable.ToolRegistration {
	return &durable.ToolRegistration{
		ToolSchema: tool.Schema(),
		Replay:     durable.ReplaySafe,
		Execute: func(ctx context.Context, args any, api durable.ToolExecutionApi) (durable.ToolExecutionResult, error) {
			if d.TurnContext != nil {
				// Only this session's conversation may use its turn state: a call from
				// anywhere else, such as a child conversation, must not inherit it.
				if api.ConversationId() != conversation {
					return durable.ToolExecutionResult{}, ErrTurnState
				}
				restored, ok := d.TurnContext()
				if !ok {
					return durable.ToolExecutionResult{}, ErrTurnState
				}
				ctx = restored
			}
			raw, err := json.Marshal(args)
			if err != nil {
				return durable.ToolExecutionResult{}, err
			}
			result, err := tool.Execute(ctx, api.CallId(), raw, nil)
			if err != nil {
				return durable.ToolExecutionResult{}, err
			}
			return durable.ToolExecutionResult{Content: result.Content}, nil
		},
	}
}

// Tools adapts every extra tool a definition carries, in order.
func Tools(d Definition, conversation durable.ConversationId) []*durable.ToolRegistration {
	registrations := []*durable.ToolRegistration{}
	for _, tool := range d.ExtraTools {
		registrations = append(registrations, ToolRegistration(d, tool, conversation))
	}
	return registrations
}
