import type {AgentRunEvent} from "@polymux/core";
import type {RunEventDto} from "@polymux/protocol";
import {json} from "./requests.js";

/** Agent run events, as the renderer receives them. */
export function eventDto(
  event: AgentRunEvent,
  conversationId: string,
  parentRunId: string | null = null,
): RunEventDto {
  return {
    runId: event.runId,
    conversationId,
    parentRunId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    payload: json(event),
  };
}

export function storedEventDto(
  event: {
    runId: string;
    sequence: number;
    type: string;
    payload: unknown;
    createdAt: string;
  },
  conversationId: string,
  parentRunId: string | null = null,
): RunEventDto {
  const timestamp =
    typeof event.payload === "object" &&
    event.payload &&
    "timestamp" in event.payload
      ? Number(event.payload.timestamp)
      : Date.parse(event.createdAt);
  return {
    runId: event.runId,
    conversationId,
    parentRunId,
    sequence: event.sequence,
    timestamp,
    type: event.type,
    payload: json(event.payload),
  };
}

/**
 * The words an assistant message actually said.
 *
 * Stored content is a `JsonValue`: sometimes a plain string, but usually the
 * block list the model replied with — reasoning, tool calls and text together.
 * Only the text blocks were addressed to the user, so the rest is dropped
 * rather than stringified. Serialising the whole value instead puts raw JSON
 * wherever a summary is shown: the schedule detail panel, and the system
 * notification a finished run posts.
 */
export function assistantText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content))
    return content
      .map((block) => blockText(block))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  return blockText(content).trim();
}

/** A single content block's text, or "" for one that carries none. */
function blockText(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object" || Array.isArray(block)) return "";
  const record = block as Record<string, unknown>;
  // Anything that is not prose the user was meant to read: reasoning the model
  // did on its way to the answer, and the tool traffic around it.
  if (typeof record.type === "string" && record.type !== "text") return "";
  return typeof record.text === "string" ? record.text : "";
}
