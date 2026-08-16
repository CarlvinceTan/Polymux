import type {
  InferenceEvent,
  InferenceService,
  InferenceTool,
  ToolCallBlock,
  ToolResultInferenceMessage,
} from "@flareai/inference";
import { AgentRunControl } from "./control.js";
import { addUsage, emptyUsage } from "./usage.js";
import type {
  AgentContext,
  AgentRunError,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunResult,
  AgentTool,
  AgentToolResult,
  RunEventSink,
  RunObserver,
  RunStatus,
  ToolExecutionMode,
  ToolHooks,
} from "./types.js";

type WithoutEventEnvelope<T> = T extends unknown
  ? Omit<T, "runId" | "sequence" | "timestamp">
  : never;
type AgentRunEventInput = WithoutEventEnvelope<AgentRunEvent>;

/** How many times a turn's inference call may be retried before the run
 * fails. Retries cover transient provider refusals such as rate limits. */
const INFERENCE_MAX_ATTEMPTS = 3;

/** Exponential backoff between retry attempts, capped so a long outage does
 * not stall the run: 1s, 2s, 4s. */
function retryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 4_000);
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #waiters: Array<(value: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0))
      waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#closed)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

export interface AgentRunnerOptions {
  inference: InferenceService;
  eventSink?: RunEventSink;
  observer?: RunObserver;
  clock?: () => number;
  /** Optional host hooks that can veto or observe every tool call. */
  hooks?: ToolHooks;
}

export interface ActiveAgentRun {
  events: AsyncIterable<AgentRunEvent>;
  result: Promise<AgentRunResult>;
  control: AgentRunControl;
}

export class AgentRunner {
  readonly #inference: InferenceService;
  readonly #sink?: RunEventSink;
  readonly #observer?: RunObserver;
  readonly #clock: () => number;
  readonly #hooks?: ToolHooks;

  constructor(options: AgentRunnerOptions) {
    this.#inference = options.inference;
    this.#sink = options.eventSink;
    this.#observer = options.observer;
    this.#clock = options.clock ?? Date.now;
    this.#hooks = options.hooks;
  }

  start(
    request: AgentRunRequest,
    control = new AgentRunControl(),
  ): ActiveAgentRun {
    const queue = new AsyncEventQueue<AgentRunEvent>();
    const signal = request.signal
      ? AbortSignal.any([request.signal, control.signal])
      : control.signal;
    const result = this.#execute(request, control, signal, queue).finally(() =>
      queue.close(),
    );
    return { events: queue, result, control };
  }

  async #execute(
    request: AgentRunRequest,
    control: AgentRunControl,
    signal: AbortSignal,
    queue: AsyncEventQueue<AgentRunEvent>,
  ): Promise<AgentRunResult> {
    let sequence = 0;
    let status: RunStatus = "idle";
    let turns = 0;
    let context = cloneContext(request.context);
    let usage = emptyUsage();
    const startedAt = this.#clock();
    let hadWorkActivity = false;
    let lastAgentMessage = "";
    const maxTurns =
      typeof request.maxTurns === "number" &&
      Number.isFinite(request.maxTurns) &&
      request.maxTurns > 0
        ? request.maxTurns
        : Infinity;
    const tools = request.tools ?? [];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const emit = async (event: AgentRunEventInput): Promise<void> => {
      const full = {
        ...event,
        runId: request.runId,
        sequence: ++sequence,
        timestamp: this.#clock(),
      } as AgentRunEvent;
      await this.#sink?.append(full);
      await this.#observer?.onEvent?.(full);
      queue.push(full);
    };

    const setStatus = async (next: RunStatus): Promise<void> => {
      status = next;
      await emit({ type: "run.state", status: next });
    };

    try {
      throwIfAborted(signal);
      await emit({ type: "run.started", model: request.model });
      await setStatus("running");

      while (turns < maxTurns) {
        throwIfAborted(signal);
        turns += 1;

        const steered = control.drainSteering();
        for (const message of steered) {
          context.messages.push(message);
          await emit({ type: "steer.accepted", message });
        }

        let compacting = false;
        const effective = request.transformContext
          ? cloneContext(
              await request.transformContext({
                runId: request.runId,
                turn: turns,
                context: cloneContext(context),
                model: request.model,
                signal,
                reportStatus: async (status) => {
                  if (status === 'compacting' && !compacting) {
                    compacting = true;
                    await emit({type: 'context.compacting', turn: turns});
                  }
                },
              }),
            )
          : cloneContext(context);
        if (compacting) await emit({type: 'context.compacted', turn: turns});
        await emit({ type: "turn.started", turn: turns, context: effective });

        let finalMessage:
          Extract<InferenceEvent, { type: "done" }>["message"] | undefined;
        let inferenceFailure: AgentRunError | undefined;
        let contentEmitted = false;

        const streamAttempt = async (): Promise<void> => {
          finalMessage = undefined;
          inferenceFailure = undefined;
          contentEmitted = false;
          for await (const event of this.#inference.stream({
            model: request.model,
            systemPrompt: effective.systemPrompt,
            messages: effective.messages,
            tools: tools.map(toInferenceTool),
            reasoning: request.reasoning,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            signal,
          })) {
            if (event.type === "start")
              await emit({
                type: "model.started",
                turn: turns,
                model: event.model,
              });
            else if (event.type === "textDelta") {
              contentEmitted = true;
              await emit({
                type: "message.text.delta",
                turn: turns,
                index: event.index,
                delta: event.delta,
              });
            } else if (event.type === "reasoningDelta") {
              contentEmitted = true;
              await emit({
                type: "message.reasoning.delta",
                turn: turns,
                index: event.index,
                delta: event.delta,
              });
            } else if (event.type === "toolCallDelta") {
              contentEmitted = true;
              await emit({
                type: "message.tool_call.delta",
                turn: turns,
                index: event.index,
                delta: event.delta,
              });
            } else if (event.type === "done") finalMessage = event.message;
            else if (event.type === "error") {
              inferenceFailure = {
                code: event.error.code === "aborted" ? "aborted" : "inference",
                message: event.error.message,
                retryable: event.error.retryable,
              };
            }
          }
        };

        // A transient refusal (rate limit, provider overload) often resolves
        // within seconds, so back off and retry. Only attempts that produced
        // no visible content are retried, so a mid-stream failure can never
        // duplicate partial text or a partially-formed tool call.
        let attempt = 0;
        while (true) {
          throwIfAborted(signal);
          attempt += 1;
          await streamAttempt();
          if (
            !inferenceFailure ||
            !inferenceFailure.retryable ||
            contentEmitted ||
            attempt >= INFERENCE_MAX_ATTEMPTS
          )
            break;
          await waitForRetry(retryDelayMs(attempt), signal);
        }

        if (inferenceFailure) throw inferenceFailure;
        if (!finalMessage)
          throw coreError(
            "inference",
            "Inference stream ended without a final message",
            true,
          );

        usage = addUsage(usage, finalMessage.usage);
        context.messages.push(finalMessage);
        const calls = finalMessage.content.filter(
          (block): block is ToolCallBlock => block.type === "toolCall",
        );
        const text = finalMessage.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n");
        if (text) lastAgentMessage = text;
        await emit({
          type: "message.completed",
          turn: turns,
          message: finalMessage,
          phase: calls.length ? "commentary" : "final",
        });

        if (calls.length) {
          hadWorkActivity = true;
          await setStatus("executing_tools");
          const results = await this.#executeTools(
            calls,
            byName,
            request.toolExecution ?? "sequential",
            request.runId,
            turns,
            signal,
            emit,
          );
          context.messages.push(...results);
          await setStatus("running");
          continue;
        }

        const lateSteering = control.drainSteering();
        if (lateSteering.length) {
          for (const message of lateSteering) {
            context.messages.push(message);
            await emit({ type: "steer.accepted", message });
          }
          continue;
        }

        await setStatus("completed");
        const result: AgentRunResult = {
          runId: request.runId,
          status: "completed",
          context,
          turns,
          usage,
          durationMs: this.#clock() - startedAt,
          hadWorkActivity,
          lastAgentMessage,
        };
        await emit({ type: "run.completed", result });
        return result;
      }

      throw coreError(
        "max_turns",
        `Agent exceeded the maximum of ${maxTurns} turns`,
        false,
      );
    } catch (cause) {
      const error = normalizeError(cause, signal);
      const cancelled = error.code === "aborted";
      await setStatus(cancelled ? "cancelled" : "failed");
      const result: AgentRunResult = {
        runId: request.runId,
        status: cancelled ? "cancelled" : "failed",
        context,
        turns,
        usage,
        durationMs: this.#clock() - startedAt,
        hadWorkActivity,
        lastAgentMessage,
        error,
      };
      await emit(
        cancelled
          ? { type: "run.cancelled", result }
          : { type: "run.failed", result },
      );
      return result;
    }
  }

  async #executeTools(
    calls: ToolCallBlock[],
    tools: Map<string, AgentTool>,
    defaultMode: ToolExecutionMode,
    runId: string,
    turn: number,
    signal: AbortSignal,
    emit: (event: AgentRunEventInput) => Promise<void>,
  ): Promise<ToolResultInferenceMessage[]> {
    const execute = async (
      call: ToolCallBlock,
    ): Promise<ToolResultInferenceMessage> => {
      const started = this.#clock();
      await emit({ type: "tool.started", turn, toolCall: call });
      const tool = tools.get(call.name);
      if (!tool) {
        const error = coreError(
          "invalid_tool_call",
          `Unknown tool: ${call.name}`,
          false,
        );
        await emit({
          type: "tool.failed",
          turn,
          toolCall: call,
          error,
          durationMs: this.#clock() - started,
        });
        return toToolMessage(call, { content: error.message, isError: true });
      }

      try {
        throwIfAborted(signal);
        if (this.#hooks?.beforeTool) {
          const decision = await this.#hooks.beforeTool(call);
          if (!decision.allow) {
            const error = coreError(
              "tool_blocked_by_hook",
              decision.message?.trim() ||
                `A configured hook blocked the ${call.name} call.`,
              false,
            );
            await emit({
              type: "tool.failed",
              turn,
              toolCall: call,
              error,
              durationMs: this.#clock() - started,
            });
            return toToolMessage(call, {
              content: error.message,
              isError: true,
            });
          }
        }
        const result = await tool.execute(call.arguments, {
          runId,
          turn,
          callId: call.id,
          signal,
          emitProgress: (message, data) =>
            emit({
              type: "tool.progress",
              turn,
              toolCallId: call.id,
              message,
              data,
            }),
        });
        await emit({
          type: "tool.completed",
          turn,
          toolCall: call,
          result,
          durationMs: this.#clock() - started,
        });
        // Observation only: a failing post-tool hook never fails the run.
        await this.#hooks?.afterTool?.(call, result).catch(() => {});
        return toToolMessage(call, result);
      } catch (cause) {
        if (signal.aborted) throw cause;
        const error = normalizeError(cause, signal);
        await emit({
          type: "tool.failed",
          turn,
          toolCall: call,
          error,
          durationMs: this.#clock() - started,
        });
        return toToolMessage(call, { content: error.message, isError: true });
      }
    };

    const parallel =
      defaultMode === "parallel" &&
      calls.every(
        (call) => tools.get(call.name)?.executionMode !== "sequential",
      );
    if (parallel) return Promise.all(calls.map(execute));
    const results: ToolResultInferenceMessage[] = [];
    for (const call of calls) results.push(await execute(call));
    return results;
  }
}

function toInferenceTool(tool: AgentTool): InferenceTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
  };
}

function toToolMessage(
  call: ToolCallBlock,
  result: AgentToolResult,
): ToolResultInferenceMessage {
  const content =
    typeof result.content === "string"
      ? [{ type: "text" as const, text: result.content }]
      : result.content;
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content,
    isError: result.isError ?? false,
    timestamp: Date.now(),
  };
}

function cloneContext(context: Readonly<AgentContext>): AgentContext {
  return {
    systemPrompt: context.systemPrompt,
    messages: structuredClone(context.messages),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw coreError("aborted", "Agent run was cancelled", false, signal.reason);
}

function coreError(
  code: AgentRunError["code"],
  message: string,
  retryable: boolean,
  cause?: unknown,
): AgentRunError {
  return { code, message, retryable, cause };
}

function normalizeError(cause: unknown, signal: AbortSignal): AgentRunError {
  if (signal.aborted)
    return coreError(
      "aborted",
      "Agent run was cancelled",
      false,
      signal.reason ?? cause,
    );
  if (isAgentRunError(cause)) return cause;
  return coreError(
    "internal",
    cause instanceof Error ? cause.message : String(cause),
    false,
    cause,
  );
}

function isAgentRunError(value: unknown): value is AgentRunError {
  return Boolean(
    value &&
    typeof value === "object" &&
    "code" in value &&
    "message" in value &&
    "retryable" in value,
  );
}
