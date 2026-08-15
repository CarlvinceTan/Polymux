import type { AgentRunEvent } from "@midas/core";
import type {
  Artifact,
  ArtifactKind,
  NewArtifact,
  NewReference,
  StoredReference,
} from "@midas/storage";

/**
 * The Summary panel's Outputs and References are fed from what a run actually
 * did: pages the agent opened become web references, files it wrote become
 * outputs. Without this, both lists only ever held what the user attached by
 * hand, so browsing a dozen sources left the panel empty.
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

  constructor(store: RunResourceStore, newId: () => string = () => crypto.randomUUID()) {
    this.#store = store;
    this.#newId = newId;
  }

  /** Called for every run event; only completed tool calls carry resources. */
  record(conversationId: string, runId: string, event: AgentRunEvent): void {
    if (!conversationId || event.type !== "tool.completed") return;
    if (event.result.isError) return;
    try {
      for (const resource of resourcesFrom(event.toolCall.name, event.toolCall.arguments, event.result))
        this.#persist(conversationId, runId, resource);
    } catch {
      // Summary bookkeeping never interrupts the run it is observing.
    }
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
  }
}

function resourcesFrom(
  name: string,
  args: Record<string, unknown>,
  result: { content: unknown; metadata?: unknown },
): RecordedResource[] {
  const payload = resultPayload(result);
  const resources: RecordedResource[] = [];
  // A call can report failure in its payload while still succeeding as a tool
  // call — a 404, `ok: false`, an error message. The agent never saw that
  // page, so it is not a source.
  if (!reachedTarget(payload)) return resources;

  // Every browser_control reply reports the page it landed on, which is the
  // page worth citing — the url the agent asked for may have redirected.
  const pageUrl = webUrl(payload.pageUrl);
  if (pageUrl) resources.push({kind: "reference", key: pageUrl, title: pageTitle(payload.pageTitle, pageUrl)});
  else {
    // Anything else that took a url — MCP fetchers, web tools, skills — cites
    // the url it was given.
    const argUrl = webUrl(args.url) ?? webUrl(args.uri);
    if (argUrl) resources.push({kind: "reference", key: argUrl, title: pageTitle(payload.pageTitle ?? payload.title, argUrl)});
  }

  // `write` reports the resolved absolute path in its metadata; that file is
  // the run's output.
  if (name === "write") {
    const path = typeof payload.path === "string" ? payload.path : typeof args.path === "string" ? args.path : "";
    if (path) resources.push({kind: "artifact", key: path, title: path.split("/").at(-1) || path});
  }

  return resources;
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

function pageTitle(value: unknown, url: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
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
