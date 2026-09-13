import { randomUUID } from "node:crypto";
import type {
  ConversationDto,
  JsonValue,
  MessageDto,
  RunEventDto,
} from "@polymux/protocol";
import { Transcript, contentText } from "./transcript.js";

export interface HostClient {
  call<T>(method: string, args?: JsonValue[]): Promise<T>;
}
export interface Configuration {
  model: string | null;
  reasoning: string;
  contextWindow: number;
  skills: string[];
  mcps: string[];
}
export class ChatSession {
  transcript = new Transcript();
  configuration: Configuration = {
    model: null,
    reasoning: "xhigh",
    contextWindow: 0,
    skills: [],
    mcps: [],
  };
  conversation?: { id: string; title: string };
  queue: string[] = [];
  busy = false;
  loading = false;
  private cancelRequested = false;
  private polling = false;
  private generation = 0;
  private detached = false;
  constructor(
    readonly client: HostClient,
    readonly changed: () => void,
  ) {}
  detach(): void {
    this.detached = true;
    this.generation++;
  }

  async open(conversation: { id: string; title: string }): Promise<void> {
    if (this.busy || this.loading || this.queue.length)
      throw new Error("Wait for pending input before switching conversations.");
    const generation = ++this.generation;
    this.loading = true;
    this.changed();
    try {
      const [messages, configuration, active] = await Promise.all([
        this.client.call<MessageDto[]>("conversations.messages", [
          conversation.id,
        ]),
        this.client.call<Configuration>("runs.configuration", [
          conversation.id,
        ]),
        this.client.call<Array<{ runId: string; conversationId: string }>>(
          "runs.active",
        ),
      ]);
      if (generation !== this.generation) return;
      const transcript = new Transcript();
      const running = active.find(
        (run) => run.conversationId === conversation.id,
      );
      const runIds = new Set(
        messages.flatMap((message) => (message.runId ? [message.runId] : [])),
      );
      if (running) runIds.add(running.runId);
      const eventsByRun = new Map<string, RunEventDto[]>();
      // Bound Host requests while rebuilding large conversations.
      for (const runId of runIds)
        eventsByRun.set(
          runId,
          await this.client.call<RunEventDto[]>("runs.events", [runId, 0]),
        );
      for (const message of messages) {
        const startedAt = Date.parse(message.createdAt) || 0;
        if (message.role === "user")
          transcript.rows.push({
            id: message.id,
            kind: "user",
            text: contentText(message.content),
            startedAt,
          });
        else if (
          message.role === "assistant" &&
          !eventsByRun
            .get(message.runId ?? "")
            ?.some((event) => event.type === "message.completed")
        )
          transcript.rows.push({
            id: message.id,
            kind: "assistant",
            text: contentText(message.content),
            startedAt,
          });
      }
      for (const [runId, events] of eventsByRun) {
        transcript.begin(runId);
        for (const event of events) transcript.apply(event);
      }
      transcript.rows.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      if (running && transcript.runId !== running.runId)
        transcript.begin(running.runId);
      else if (!running && transcript.status === "running")
        transcript.status = "idle";
      if (generation !== this.generation) return;
      this.transcript = transcript;
      this.configuration = configuration;
      transcript.model = configuration.model ?? "";
      transcript.contextWindow = configuration.contextWindow;
      this.conversation = conversation;
      this.changed();
    } finally {
      this.loading = false;
      this.changed();
    }
  }

  async submit(text: string): Promise<void> {
    if (this.detached) throw new Error("The terminal session is closed.");
    if (this.loading)
      throw new Error("Wait for the conversation to finish loading.");
    if (!this.conversation) throw new Error("Choose a conversation first.");
    if (this.busy || this.transcript.status === "running") {
      this.queue.push(text);
      this.changed();
      return;
    }
    this.busy = true;
    this.cancelRequested = false;
    this.changed();
    try {
      const id = randomUUID();
      const started = await this.client.call<{ runId: string }>("runs.start", [
        {
          conversationId: this.conversation.id,
          text,
          messageId: id,
          attachments: [],
          reasoning: this.configuration.reasoning,
        },
      ]);
      this.transcript.rows.push({ id, kind: "user", text });
      this.transcript.begin(started.runId);
      if (this.cancelRequested) await this.cancel();
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async poll(): Promise<void> {
    if (
      this.detached ||
      this.polling ||
      (this.transcript.status !== "running" &&
        !this.transcript.rows.some(
          (row) => row.childRunId && !row.childSettled,
        ))
    )
      return;
    this.polling = true;
    const transcript = this.transcript;
    try {
      const { events, draft } = await this.client.call<{
        events: RunEventDto[];
        draft: { turn: number; text: string; timestamp: number } | null;
      }>("runs.updates", [transcript.runId, transcript.sequence]);
      if (this.detached || transcript !== this.transcript) return;
      for (const event of events) transcript.apply(event);
      if (draft && transcript.status === "running") transcript.draft(draft);
      await Promise.all(
        transcript.rows
          .filter((row) => row.childRunId && !row.childSettled)
          .map(async (row) => {
            const child = await this.client.call<{ events: RunEventDto[] }>(
              "runs.updates",
              [row.childRunId, row.childSequence ?? 0],
            );
            if (!this.detached && transcript === this.transcript)
              transcript.applyChild(row, child.events);
          }),
      );
      if (transcript.status === "completed" && this.queue.length) {
        const text = this.queue.shift()!;
        try {
          await this.submit(text);
        } catch (error) {
          this.queue.unshift(text);
          throw error;
        }
      }
      this.changed();
    } finally {
      this.polling = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.busy) this.cancelRequested = true;
    // Unsent follow-ups stay visible until the user explicitly discards or retries them.
    if (this.transcript.status === "running")
      await this.client.call("runs.cancel", [this.transcript.runId]);
  }
  async configure(value: {
    model?: string;
    reasoning?: string;
  }): Promise<void> {
    if (!this.conversation || this.busy || this.transcript.status === "running")
      throw new Error("Wait for this run to finish before changing settings.");
    this.configuration = await this.client.call<Configuration>(
      "runs.configure",
      [this.conversation.id, value],
    );
    this.transcript.model = this.configuration.model ?? "";
    this.transcript.contextWindow = this.configuration.contextWindow;
    this.changed();
  }
  conversations(): Promise<ConversationDto[]> {
    return this.client.call("conversations.list");
  }
}
