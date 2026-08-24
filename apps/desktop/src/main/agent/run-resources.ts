import type { AgentRunEvent } from "@polymux/core";
import type {
  Artifact,
  ArtifactKind,
  NewArtifact,
  NewReference,
  StoredReference,
} from "@polymux/storage";

/**
 * The Summary panel's Outputs and References are fed from what a run actually
 * did: files it wrote become outputs, and links it cites in its reply become
 * references. Without this, both lists only ever held what the user attached by
 * hand, so researching a dozen sources left the panel empty.
 *
 * References follow the answer, not the browsing. Recording every page a run
 * opened filled the panel with search-result pages and dead ends — three rows
 * of the same query, none of them a source the reply actually stands on. A
 * link the agent chose to put in its readable text is one it is citing, so
 * that is what gets listed; pages it merely passed through only contribute
 * their titles, in case one of them is later cited by bare url.
 */
export interface RunResourceStore {
  createArtifact(input: NewArtifact): Artifact;
  listArtifacts(conversationId?: string): Artifact[];
  createReference(input: NewReference): StoredReference;
  listReferences(conversationId: string): StoredReference[];
}

interface RecordedResource {
  kind: "reference" | "artifact";
  /** The identity used for de-duplication: a URL, or an absolute file path. */
  key: string;
  title: string;
}

export class RunResourceRecorder {
  readonly #store: RunResourceStore;
  readonly #newId: () => string;
  /** Keys already stored, per conversation, so a run that reads one page
   * fifteen times contributes one reference. Seeded from storage on first use
   * so restarts and earlier runs still de-duplicate. */
  readonly #seen = new Map<string, Set<string>>();
  /** Page titles learned while the run browsed, per conversation. A cited bare
   * url reads better as "Upcoming AI events — Eventbrite" than as a hostname,
   * and this is the only place that title was ever available. */
  readonly #titles = new Map<string, Map<string, string>>();

  constructor(store: RunResourceStore, newId: () => string = () => crypto.randomUUID()) {
    this.#store = store;
    this.#newId = newId;
  }

  /** Called for every run event. Tool calls contribute outputs and remembered
   * titles; the assistant's own text contributes the references. */
  record(conversationId: string, runId: string, event: AgentRunEvent): void {
    if (!conversationId) return;
    try {
      if (event.type === "tool.completed") {
        if (event.result.isError) return;
        this.#noteTitles(conversationId, event.toolCall.arguments, event.result);
        for (const resource of artifactsFrom(event.toolCall.name, event.toolCall.arguments, event.result))
          this.#persist(conversationId, runId, resource);
        return;
      }
      if (event.type !== "message.completed") return;
      for (const link of citedLinks(event.message.content))
        this.#persist(conversationId, runId, {
          kind: "reference",
          key: link.url,
          title: link.title || this.#titles.get(conversationId)?.get(link.url) || hostTitle(link.url),
        });
    } catch {
      // Summary bookkeeping never interrupts the run it is observing.
    }
  }

  #noteTitles(conversationId: string, args: Record<string, unknown>, result: {content: unknown; metadata?: unknown}): void {
    const payload = resultPayload(result);
    if (!reachedTarget(payload)) return;
    const url = webUrl(payload.pageUrl) ?? webUrl(args.url) ?? webUrl(args.uri);
    const title = payload.pageTitle ?? payload.title;
    if (!url || typeof title !== "string" || !title.trim()) return;
    const titles = this.#titles.get(conversationId) ?? new Map<string, string>();
    titles.set(url, title.trim());
    this.#titles.set(conversationId, titles);
  }

  #persist(conversationId: string, runId: string | null, resource: RecordedResource): void {
    if (resource.kind === "reference") this.#persistReference(conversationId, runId, resource);
    else this.#persistArtifact(conversationId, runId, resource);
  }

  #persistReference(conversationId: string, runId: string | null, resource: RecordedResource): void {
    if (!this.#claim(conversationId, resource.key)) return;
    try {
      this.#store.createReference({
        id: this.#newId(),
        conversationId,
        runId,
        kind: "web",
        title: resource.title,
        uri: resource.key,
      });
    } catch {
      // A resource that cannot be stored must never fail the run it came from.
      this.#release(conversationId, resource.key);
    }
  }

  #persistArtifact(conversationId: string, runId: string | null, resource: RecordedResource): void {
    if (!this.#claim(conversationId, resource.key)) return;
    try {
      this.#store.createArtifact({
        id: this.#newId(),
        conversationId,
        runId,
        kind: artifactKind(resource.key),
        name: resource.title,
        path: resource.key,
      });
    } catch {
      this.#release(conversationId, resource.key);
    }
  }

  /** True when this key is new to the conversation and now spoken for. */
  #claim(conversationId: string, key: string): boolean {
    const seen = this.#seenFor(conversationId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }

  #release(conversationId: string, key: string): void {
    this.#seen.get(conversationId)?.delete(key);
  }

  #seenFor(conversationId: string): Set<string> {
    const cached = this.#seen.get(conversationId);
    if (cached) return cached;
    const seen = new Set<string>([
      ...this.#store.listReferences(conversationId).map((reference) => reference.uri),
      ...this.#store.listArtifacts(conversationId).map((artifact) => artifact.path),
    ]);
    this.#seen.set(conversationId, seen);
    return seen;
  }

  /** Deleting a conversation drops its resources, so drop the memo with it. */
  forget(conversationId: string): void {
    this.#seen.delete(conversationId);
    this.#titles.delete(conversationId);
  }
}

function artifactsFrom(
  name: string,
  args: Record<string, unknown>,
  result: { content: unknown; metadata?: unknown },
): RecordedResource[] {
  // `write` reports the resolved absolute path in its metadata; that file is
  // the run's output.
  if (name !== "write") return [];
  const payload = resultPayload(result);
  // A call can report failure in its payload while still succeeding as a tool
  // call — `ok: false`, an error message. Nothing was written.
  if (!reachedTarget(payload)) return [];
  const path = typeof payload.path === "string" ? payload.path : typeof args.path === "string" ? args.path : "";
  return path ? [{kind: "artifact", key: path, title: path.split("/").at(-1) || path}] : [];
}

/** Markdown links, then bare urls, in the order the reply mentions them.
 * Trailing punctuation is sentence, not url: "see https://x.com/a." */
function citedLinks(content: unknown): Array<{url: string; title: string}> {
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks
    .filter((block): block is {type: "text"; text: string} => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
  const links: Array<{url: string; title: string}> = [];
  const seen = new Set<string>();
  const add = (raw: string, title: string): void => {
    const url = webUrl(raw.replace(/[).,;:!?'"]+$/, ""));
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({url, title: title.trim()});
  };
  const markdown = /\[([^\]]+)\]\(\s*(https?:\/\/[^\s)]+)/g;
  for (const match of text.matchAll(markdown)) add(match[2]!, match[1]!);
  // Bare urls, minus the ones already claimed as a markdown link's target.
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) add(match[0], "");
  return links;
}

function hostTitle(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Did the call actually reach what it went for? */
function reachedTarget(payload: Record<string, unknown>): boolean {
  if (payload.ok === false || payload.success === false) return false;
  if (typeof payload.error === "string" && payload.error.trim()) return false;
  const status = payload.status ?? payload.statusCode;
  return !(typeof status === "number" && status >= 400);
}

/** Tool results carry structure in `metadata`, or as JSON in their text. */
function resultPayload(result: { content: unknown; metadata?: unknown }): Record<string, unknown> {
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const text = typeof result.content === "string" ? result.content : "";
  if (!text.startsWith("{")) return metadata;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? {...parsed, ...metadata} : metadata;
  } catch {
    return metadata;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only real http(s) pages are references; about:blank and data: urls are not. */
function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const ARTIFACT_KINDS: Record<string, ArtifactKind> = {
  doc: "document", docx: "document", md: "document", txt: "document", pdf: "document", rtf: "document",
  ppt: "slides", pptx: "slides", key: "slides",
  csv: "sheet", tsv: "sheet", xls: "sheet", xlsx: "sheet",
  png: "photo", jpg: "photo", jpeg: "photo", gif: "photo", webp: "photo", svg: "photo",
  mp4: "video", mov: "video", webm: "video",
};

function artifactKind(path: string): ArtifactKind {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return ARTIFACT_KINDS[extension] ?? "other";
}
