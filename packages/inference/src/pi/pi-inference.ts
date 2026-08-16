import type { AssistantMessage, Models } from "@earendil-works/pi-ai";
import type { InferenceService } from "../contracts.js";
import type {
  InferenceError,
  InferenceEvent,
  InferenceModel,
  InferenceRequest,
  ModelRef,
} from "../types.js";
import {
  fromPiMessage,
  fromPiModel,
  fromPiToolCall,
  toPiContext,
} from "./conversion.js";

export interface PiInferenceOptions {
  clock?: () => number;
}

function classifyError(
  message: string,
  aborted: boolean,
): Pick<InferenceError, "code" | "retryable"> {
  if (aborted) return { code: "aborted", retryable: false };
  const lower = message.toLowerCase();
  // Access refusals that a different key cannot fix — region locks, opt-in
  // gates, unsupported countries. They often arrive as 403s, so they have to be
  // recognised before the credential check below claims them.
  if (/regionerror|region|unsupported_country|opt.?in|not available in your/.test(lower))
    return { code: "provider_error", retryable: false };
  if (/auth|api key|unauthorized|forbidden|401|403/.test(lower))
    return { code: "auth", retryable: false };
  if (/rate.?limit|429|too many requests|quota.?exceed|insufficient_quota|usage limit/.test(lower))
    return { code: "rate_limit", retryable: true };
  if (/context|token limit|too long|maximum.*token/.test(lower))
    return { code: "context_overflow", retryable: false };
  return { code: "provider_error", retryable: true };
}

export class PiInference implements InferenceService {
  readonly #models: Models;
  readonly #clock: () => number;

  constructor(models: Models, options: PiInferenceOptions = {}) {
    this.#models = models;
    this.#clock = options.clock ?? Date.now;
  }

  listModels(provider?: string): InferenceModel[] {
    return this.#models.getModels(provider).map(fromPiModel);
  }

  getModel(ref: ModelRef): InferenceModel | null {
    const model = this.#models.getModel(ref.provider, ref.id);
    return model ? fromPiModel(model) : null;
  }

  async listAvailableModels(provider?: string): Promise<InferenceModel[]> {
    return (await this.#models.getAvailable(provider)).map(fromPiModel);
  }

  async *stream(request: InferenceRequest): AsyncIterable<InferenceEvent> {
    const model = this.#models.getModel(
      request.model.provider,
      request.model.id,
    );
    if (!model) {
      yield {
        type: "error",
        error: {
          code: "model_not_found",
          message: `Model not found: ${request.model.provider}/${request.model.id}`,
          retryable: false,
          provider: request.model.provider,
          model: request.model.id,
        },
      };
      return;
    }

    try {
      const context = toPiContext(
        request.systemPrompt,
        request.messages,
        request.tools,
        model,
        this.#clock,
      );
      const reasoning =
        request.reasoning === "off" ? undefined : request.reasoning;
      const stream = this.#models.streamSimple(model, context, {
        apiKey: request.apiKey,
        reasoning,
        temperature: request.temperature,
        maxTokens: request.maxOutputTokens,
        cacheRetention: request.cacheRetention,
        sessionId: request.sessionId,
        timeoutMs: request.timeoutMs,
        maxRetries: request.maxRetries,
        signal: request.signal,
      });

      for await (const event of stream) {
        switch (event.type) {
          case "start":
            yield { type: "start", model: fromPiModel(model) };
            break;
          case "text_start":
            yield { type: "textStart", index: event.contentIndex };
            break;
          case "text_delta":
            yield {
              type: "textDelta",
              index: event.contentIndex,
              delta: event.delta,
            };
            break;
          case "text_end":
            yield {
              type: "textEnd",
              index: event.contentIndex,
              text: event.content,
            };
            break;
          case "thinking_start":
            yield { type: "reasoningStart", index: event.contentIndex };
            break;
          case "thinking_delta":
            yield {
              type: "reasoningDelta",
              index: event.contentIndex,
              delta: event.delta,
            };
            break;
          case "thinking_end":
            yield {
              type: "reasoningEnd",
              index: event.contentIndex,
              text: event.content,
            };
            break;
          case "toolcall_start":
            yield { type: "toolCallStart", index: event.contentIndex };
            break;
          case "toolcall_delta":
            yield {
              type: "toolCallDelta",
              index: event.contentIndex,
              delta: event.delta,
            };
            break;
          case "toolcall_end":
            yield {
              type: "toolCallEnd",
              index: event.contentIndex,
              toolCall: fromPiToolCall(event.toolCall),
            };
            break;
          case "done":
            yield {
              type: "done",
              reason: event.reason,
              message: fromPiMessage(event.message),
            };
            break;
          case "error":
            yield this.#errorEvent(
              event.error,
              request,
              event.reason === "aborted" || request.signal?.aborted === true,
            );
            break;
        }
      }
    } catch (cause) {
      const aborted = request.signal?.aborted ?? false;
      const errorMessage =
        cause instanceof Error ? cause.message : String(cause);
      const classification = classifyError(errorMessage, aborted);
      yield {
        type: "error",
        error: {
          ...classification,
          message: errorMessage,
          provider: request.model.provider,
          model: request.model.id,
        },
      };
    }
  }

  #errorEvent(
    message: AssistantMessage,
    request: InferenceRequest,
    aborted: boolean,
  ): InferenceEvent {
    const errorMessage =
      message.errorMessage ??
      (aborted ? "Inference request aborted" : "Inference provider error");
    return {
      type: "error",
      error: {
        ...classifyError(errorMessage, aborted),
        message: errorMessage,
        provider: request.model.provider,
        model: request.model.id,
      },
      message: fromPiMessage(message),
    };
  }
}
