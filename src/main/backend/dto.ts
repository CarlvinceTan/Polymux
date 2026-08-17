import type {AgentRunEvent} from "@flareai/core";
import type {RunEventDto} from "@flareai/protocol";
import {parse as parseToml} from "smol-toml";
import {json, number} from "./requests.js";

/** Agent run events, as the renderer receives them. */
export function eventDto(event: AgentRunEvent, conversationId: string): RunEventDto {
  return {
    runId: event.runId,
    conversationId,
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
    sequence: event.sequence,
    timestamp,
    type: event.type,
    payload: json(event.payload),
  };
}
