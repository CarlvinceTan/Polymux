import type {
  AgentRunEvent,
  AgentRunResult,
  ActiveAgentRun,
  AgentTool,
} from "@midas/core";
import { AgentRunner } from "@midas/core";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
  InferenceMessage,
  InferenceService,
  ModelRef,
  ReasoningEffort,
} from "@midas/inference";
import type { JsonValue, Storage, StoredMessage } from "@midas/storage";
import { ToolRegistry } from "@midas/tools";
import { buildSystemPrompt } from "./prompts/system-prompt.js";
import {
  CompactionManager,
  type CompactionSettings,
} from "./context/compaction.js";
import {
  SkillLoader,
  parseSkillCommand,
  type SkillLoaderOptions,
} from "./skills/loader.js";
import { GoalManager } from "./goals/manager.js";
import { MemoryManager } from "./memory/manager.js";
import { createTaskTool, type SubagentRequest } from "./subagents/task-tool.js";

export interface ChronicleContextProvider {
  promptContext(): {
    directory: string;
    instructionsPath: string;
    enabled: boolean;
  };
}

export interface EnvironmentContextProvider {
  promptContext(): {
    time?: { local: string; timeZone: string; utcOffset: string };
    locationEnabled: boolean;
    location?: {
      latitude: number;
      longitude: number;
      accuracy: number;
      updatedAt: string;
    };
  };
}

export interface MidasAgentOptions {
  inference: InferenceService;
  storage: Storage;
  memory: MemoryManager;
  chronicle?: ChronicleContextProvider;
  environment?: EnvironmentContextProvider;
  tools: ToolRegistry;
  model: ModelRef;
  reasoning?: ReasoningEffort;
  basePrompt?: string;
  skills?: SkillLoaderOptions;
  compaction?: Partial<CompactionSettings>;
}

export interface StartMidasRunInput {
  conversationId: string;
  text: string;
  userMessageId?: string;
  runId?: string;
  signal?: AbortSignal;
  includeSubagents?: boolean;
  parentRunId?: string;
  contextMode?: "conversation" | "none" | "recent";
  attachments?: string[];
  asGoal?: boolean;
}

export class MidasAgent {
  readonly goals: GoalManager;
  readonly memory: MemoryManager;
  readonly #options: MidasAgentOptions;
  readonly #compaction: CompactionManager;
  readonly #skillLoader: SkillLoader;
  constructor(options: MidasAgentOptions) {
    this.#options = options;
    this.goals = new GoalManager(options.storage);
    this.memory = options.memory;
    this.#compaction = new CompactionManager(
      options.inference,
      options.storage,
      options.compaction,
    );
    this.#skillLoader = new SkillLoader(options.skills);
  }

  start(input: StartMidasRunInput): ActiveAgentRun {
    const conversation = this.#options.storage.getConversation(
      input.conversationId,
    );
    if (!conversation)
      throw new Error(`Conversation not found: ${input.conversationId}`);
    const skillResult = this.#skillLoader.load();
    const skillCommand = parseSkillCommand(input.text, skillResult.skills);
    const text = skillCommand
      ? `${readSkill(skillCommand.skill.filePath)}${skillCommand.arguments ? `\n\nUser: ${skillCommand.arguments}` : ""}`
      : input.text;
    if (input.asGoal) {
      const existing = this.goals.get(input.conversationId);
      if (existing && existing.status !== "completed")
        this.goals.execute(input.conversationId, { action: "clear" });
      this.goals.execute(input.conversationId, {
        action: "create",
        objective: input.text,
      });
    }
    const runId = input.runId ?? crypto.randomUUID();
    if (!input.parentRunId) {
      const message = this.#options.storage.appendMessage({
        id: input.userMessageId ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        runId: null,
        role: "user",
        content: text,
        metadata: input.asGoal ? { asGoal: true } : {},
      });
      for (const attachmentPath of input.attachments ?? []) {
        this.#options.storage.addAttachment({
          id: crypto.randomUUID(),
          messageId: message.id,
          name: basename(attachmentPath),
          path: attachmentPath,
          mimeType: null,
          size: null,
          sha256: null,
        });
      }
    }
    this.#options.storage.createRun({
      id: runId,
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      model: `${this.#options.model.provider}/${this.#options.model.id}`,
      status: "running",
    });
    const stored = this.#options.storage.listMessages(input.conversationId);
    const durableMessages = stored
      .map((message) =>
        toInferenceMessage(
          message,
          this.#options.storage
            .listAttachments(message.id)
            .map((attachment) => attachment.path),
        ),
      )
      .filter((item): item is InferenceMessage => item !== null);
    const messages = selectContext(
      durableMessages,
      input.contextMode ?? "conversation",
    );
    if (input.parentRunId) messages.push({ role: "user", content: text });
    const memory = this.memory.promptContext(input.conversationId);
    const chronicle = this.#options.chronicle?.promptContext();
    const environment = this.#options.environment?.promptContext();
    const systemPrompt = buildSystemPrompt({
      basePrompt: this.#options.basePrompt,
      preferences: this.#options.storage.listPreferences(),
      memorySummary: memory.summary,
      memoryRegistryPath: memory.registryPath,
      memories: memory.conversationMemories,
      chronicle: chronicle?.enabled ? chronicle : undefined,
      environment,
      skills: skillResult.skills,
      goal: this.goals.get(input.conversationId),
    });
    const tools = [
      ...this.#options.tools.list(),
      ...this.goals.tools(input.conversationId),
    ];
    if (input.includeSubagents !== false)
      tools.push(
        createTaskTool((request, signal) =>
          this.#runSubagent(input.conversationId, runId, request, signal),
        ),
      );
    const runner = new AgentRunner({
      inference: this.#options.inference,
      eventSink: { append: (event) => this.#persistEvent(event) },
    });
    const active = runner.start({
      runId,
      model: this.#options.model,
      reasoning: this.#options.reasoning,
      context: { systemPrompt, messages },
      tools,
      toolExecution: "parallel",
      signal: input.signal,
      transformContext: ({ context, signal }) =>
        this.#compaction.transform(
          input.conversationId,
          this.#options.model,
          context,
          signal,
        ),
    });
    void active.result.then((result) =>
      this.#finish(input, result, stored.length),
    );
    return active;
  }

  async #runSubagent(
    conversationId: string,
    parentRunId: string,
    request: SubagentRequest,
    signal: AbortSignal,
  ) {
    const active = this.start({
      conversationId,
      text: request.prompt,
      parentRunId,
      includeSubagents: false,
      signal,
      contextMode: request.context,
    });
    const result = await active.result;
    return {
      runId: result.runId,
      status: result.status,
      result:
        assistantText(result) ||
        result.error?.message ||
        "Subagent returned no text.",
    };
  }

  #persistEvent(event: AgentRunEvent): void {
    this.#options.storage.appendRunEvent(event.runId, event.type, json(event));
  }
  #finish(
    input: StartMidasRunInput,
    result: AgentRunResult,
    initialMessages: number,
  ): void {
    this.#options.storage.updateRun(result.runId, {
      status: result.status,
      error: result.error ? json(result.error) : null,
      usage: json(result.usage),
    });
    if (input.parentRunId || result.status !== "completed") return;
    const additions = result.context.messages
      .slice(initialMessages)
      .filter((message) => message.role === "assistant");
    for (const message of additions)
      this.#options.storage.appendMessage({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        runId: result.runId,
        role: "assistant",
        content: json(message.content),
      });
    this.memory.recordRollout({
      conversationId: input.conversationId,
      runId: result.runId,
      userText: input.text,
      assistantText: assistantText(result),
    });
  }
}

function toInferenceMessage(
  message: StoredMessage,
  attachments: string[],
): InferenceMessage | null {
  if (message.role === "user") {
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    return {
      role: "user",
      content: attachments.length
        ? `${content}\n\nAttached files:\n${attachments.map((path) => `- ${path}`).join("\n")}`
        : content,
    };
  }
  if (message.role === "assistant" && Array.isArray(message.content))
    return { role: "assistant", content: message.content as never };
  return null;
}
function assistantText(result: AgentRunResult): string {
  const message = [...result.context.messages]
    .reverse()
    .find((item) => item.role === "assistant");
  return message?.role === "assistant"
    ? message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";
}
function json(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message } : item,
    ),
  ) as JsonValue;
}
function readSkill(path: string): string {
  return readFileSync(path, "utf8");
}

function selectContext(
  messages: InferenceMessage[],
  mode: NonNullable<StartMidasRunInput["contextMode"]>,
): InferenceMessage[] {
  if (mode === "none") return [];
  if (mode === "recent") return messages.slice(-8);
  return messages;
}
