import type { AgentTool } from "@flareai/core";
import { digestRecording, readRecording, type RecordingSession } from "@flareai/computer-history";
import type { RecordingCapture } from "./capture.js";

/**
 * How long after a recording ends it is still the one the user means when they
 * come back and say "done". Long enough to cover ending it from the menu bar
 * and walking back to FlareAI; short enough that yesterday's is never picked up.
 */
const RECENTLY_ENDED_MS = 10 * 60 * 1000;

/**
 * Record & Replay's one tool. `stop` answers with a digest rather than the
 * stream: the workflow's apps, its steps in order, and the apps merely passed
 * through, with arriving and leaving trimmed off. That is what the user gets
 * summarised back. The raw stream stays on disk behind `eventsPath` for the
 * detail a digest cannot carry, read with ordinary file tools so a half-hour
 * demonstration never arrives as one tool result.
 */
export function createRecordingTool(capture: RecordingCapture): AgentTool {
  return {
    name: "record_workflow",
    // The user demonstrates to the run they are talking to. A delegated run
    // cannot watch someone work — and only one recording exists at a time, so
    // a subagent starting one would take the recorder out from under the
    // conversation that was asked for it.
    mainAgentOnly: true,
    description: [
      "Watch the user demonstrate a workflow on their Mac, so it can be turned into a reusable skill.",
      "Actions: 'start' begins recording their clicks, keystroke counts, app switches and the",
      "content of the windows they work in; 'status' reports whether a recording is running and how",
      "long it has left; 'stop' ends it and returns a digest of what was demonstrated; 'cancel' ends",
      "it and discards the capture entirely; 'list' shows recordings already on disk; 'digest'",
      "re-reads a finished recording.",
      "Only one recording runs at a time, and every recording ends on its own after 30 minutes.",
      "A menu-bar item shows while recording, and the user can stop or cancel from there; if they",
      "did, 'stop' still returns that recording and its endReason says so.",
      "After 'start' succeeds, end your turn and let the user work — never sleep, poll or loop",
      "waiting for them to finish.",
      "'stop' returns a digest of the workflow: the apps it actually happened in, the steps in",
      "order, and the apps the user only passed through. Summarise from that. FlareAI's own window",
      "is never captured, and arriving and leaving are trimmed off, so the digest is the workflow",
      "rather than everything that happened. Read eventsPath only when you need detail the digest",
      "does not carry — it is JSON lines, oldest first.",
    ].join(" "),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "status", "stop", "cancel", "list", "digest"] },
        label: { type: "string", description: "What the user called this workflow, if they said." },
        id: { type: "string", description: "Recording id, for 'digest'. Defaults to the newest." },
        minutes: {
          type: "number",
          description: "Recording limit in minutes. Defaults to 30, which is also the maximum.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input) {
      const action = String(input.action ?? "");

      if (action === "digest") {
        const id = typeof input.id === "string" ? input.id.trim() : "";
        const session = id ? capture.read(id) : capture.list()[0];
        if (!session) return fail(id ? `No recording ${id}.` : "No recordings yet.");
        return {
          content: JSON.stringify(digestRecording(session, readRecording(session.eventsPath))),
        };
      }

      if (action === "list")
        return { content: JSON.stringify({ recordings: capture.list().map(summarise) }) };

      if (action === "status") {
        const active = capture.active();
        if (!active) return { content: JSON.stringify({ recording: false }) };
        return { content: JSON.stringify({ recording: true, ...summarise(active), ...remaining(active) }) };
      }

      if (action === "start") {
        const running = capture.active();
        // Refused rather than restarted: the running capture may be the one
        // the user actually wants, and only they can say.
        if (running)
          return fail(
            `A recording is already running (${running.id}). Ask the user whether to use it or stop it first.`,
          );
        const label = typeof input.label === "string" ? input.label.trim() : "";
        const minutes = typeof input.minutes === "number" ? input.minutes : undefined;
        try {
          const session = await capture.start({
            label: label || null,
            ...(minutes && minutes > 0 ? { limitMs: Math.round(minutes * 60_000) } : {}),
          });
          return {
            content: JSON.stringify({
              started: true,
              ...summarise(session),
              limitMinutes: Math.round(session.limitMs / 60_000),
              note: "Tell the user recording has begun and how long they have, then end your turn.",
            }),
          };
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      }

      if (action === "stop" || action === "cancel") {
        let session = capture.stop(action === "cancel" ? "cancelled" : "stopped");
        // The user may have ended it from the menu bar and only then come back
        // to say so. Asking them to redo something they already did would be
        // absurd, so the recording they mean is picked up where they left it.
        if (!session) {
          const recent = capture.lastEnded();
          const ended = recent?.endedAt ? Date.parse(recent.endedAt) : 0;
          if (!recent || Date.now() - ended > RECENTLY_ENDED_MS)
            return fail("No recording is running.");
          if (action === "cancel")
            return {
              content: JSON.stringify({
                cancelled: recent.endReason === "controls_cancelled",
                id: recent.id,
                endReason: recent.endReason,
                note:
                  recent.endReason === "controls_cancelled"
                    ? "Already discarded from the menu bar. Acknowledge and stop."
                    : "This recording was kept, not discarded. Ask whether to discard it.",
              }),
            };
          if (recent.endReason === "controls_cancelled")
            return {
              content: JSON.stringify({
                id: recent.id,
                endReason: recent.endReason,
                note: "The user cancelled from the menu bar; the capture is gone. Do not build a skill.",
              }),
            };
          session = recent;
        }
        if (action === "cancel")
          return { content: JSON.stringify({ cancelled: true, id: session.id, discarded: true }) };
        const digest = digestRecording(session, readRecording(session.eventsPath));
        return {
          content: JSON.stringify({
            stopped: true,
            ...summarise(session),
            digest,
            note:
              digest.steps.length === 0
                ? "The recording caught no actions. Tell the user plainly; do not invent a workflow."
                : "Summarise the workflow from the digest, then ask whether to build a skill. Do not repeat sensitive values.",
          }),
        };
      }

      return fail(`Unknown action '${action}'.`);
    },
  };
}

function summarise(session: RecordingSession) {
  return {
    id: session.id,
    label: session.label,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    events: session.events,
    windows: session.windows,
    metadataPath: session.metadataPath,
    eventsPath: session.eventsPath,
  };
}

function remaining(session: RecordingSession) {
  const elapsed = Date.now() - Date.parse(session.startedAt);
  return { minutesRemaining: Math.max(0, Math.round((session.limitMs - elapsed) / 60_000)) };
}

function fail(message: string) {
  return { content: JSON.stringify({ error: message }), isError: true };
}
