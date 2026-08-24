import type { AgentTool } from "@polymux/core";
import type { ScheduleDto, ScheduleFrequencyDto, ScheduleInput, SchedulePatch } from "@polymux/protocol";

/** The scheduler, as the tool needs it. */
export interface ScheduleBook {
  list(): ScheduleDto[];
  create(input: ScheduleInput): ScheduleDto;
  update(id: string, patch: SchedulePatch): ScheduleDto;
  remove(id: string): void;
  runNow(id: string): ScheduleDto;
}

/**
 * How the user actually gets a schedule: they ask for one in the chat, and the
 * agent writes it down here. Without this the Schedule view could only ever
 * show rows nothing put there.
 */
export function createScheduleTool(book: ScheduleBook): AgentTool {
  return {
    name: "schedule",
    description: [
      "Run an instruction on a repeating schedule, unattended.",
      "Actions: 'list' shows the schedules that exist, with their ids, cadence, next run and the outcome of their last run;",
      "'create' adds one — give it a short title, the prompt to run each time, and a frequency;",
      "'update' changes a schedule's title, prompt, frequency, or pauses and resumes it;",
      "'remove' deletes one; 'run' fires one now without changing its cadence.",
      "Frequency is an object: {kind:'once', at: epochMs} | {kind:'hourly', interval?, minute?} |",
      "{kind:'daily', interval?, time:'HH:MM'} | {kind:'weekly', interval?, days:[0-6, 0 is Sunday], time:'HH:MM'} |",
      "{kind:'monthly', interval?, dayOfMonth, time:'HH:MM'} | {kind:'yearly', interval?, month:0-11, dayOfMonth, time:'HH:MM'}.",
      "Times are read in the user's own time zone unless a timeZone is given.",
      "The prompt runs with no one watching, so write it as a complete standalone instruction:",
      "it cannot ask a question or wait for a confirmation.",
    ].join(" "),
    executionMode: "sequential",
    parameters: {
      type: "object",
      properties: {
        action: {type: "string", enum: ["list", "create", "update", "remove", "run"]},
        id: {type: "string"},
        title: {type: "string"},
        prompt: {type: "string"},
        frequency: {type: "object", additionalProperties: true},
        status: {type: "string", enum: ["active", "paused"]},
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(input) {
      const action = String(input.action ?? "");
      if (action === "list") return {content: JSON.stringify({schedules: book.list().map(summarise)})};

      if (action === "create") {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
        if (!title || !prompt) return fail("create needs a title and a prompt");
        if (!input.frequency || typeof input.frequency !== "object")
          return fail("create needs a frequency, e.g. {kind:'daily', time:'08:00'}");
        try {
          return {content: JSON.stringify(summarise(book.create({
            title,
            prompt,
            frequency: input.frequency as ScheduleFrequencyDto,
          })))};
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      }

      const id = typeof input.id === "string" ? input.id : "";
      if (!id) return fail(`${action} needs the id of a schedule — use 'list' to find it`);
      try {
        if (action === "remove") {
          book.remove(id);
          return {content: "removed"};
        }
        if (action === "run") return {content: JSON.stringify(summarise(book.runNow(id)))};
        return {content: JSON.stringify(summarise(book.update(id, {
          ...(typeof input.title === "string" ? {title: input.title} : {}),
          ...(typeof input.prompt === "string" ? {prompt: input.prompt} : {}),
          ...(input.frequency && typeof input.frequency === "object"
            ? {frequency: input.frequency as ScheduleFrequencyDto}
            : {}),
          ...(input.status === "active" || input.status === "paused" ? {status: input.status} : {}),
        })))};
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

/** The whole history is more than the model needs; the last run is the part
 * that says whether the thing is working. */
function summarise(item: ScheduleDto) {
  const last = item.history[0];
  return {
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    frequency: item.frequency,
    status: item.status,
    nextRunAt: item.nextRunAt ? new Date(item.nextRunAt).toISOString() : null,
    lastRun: last
      ? {
          at: new Date(last.startedAt).toISOString(),
          outcome: last.outcome,
          summary: last.summary ?? null,
          error: last.error ?? null,
        }
      : null,
  };
}

function fail(message: string) {
  return {content: message, isError: true};
}
