import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DriveEntryDto } from "@polymux/protocol";
import { SIMPLE_UPLOAD_LIMIT, uploadInChunks } from "./chunks.js";
import { downloadToFile } from "./download.js";
import {
  DriveRequestError,
  jsonRequest,
  request,
  type RequestOptions,
} from "./http.js";
import { OAuthClient, oauthAppFromEnv } from "./oauth.js";
import {
  copyName,
  DriveConflictError,
  type DriveAdapter,
  type DriveConsentPrompt,
  type DriveProbe,
  type DriveSecretStore,
  type DriveWriteOptions,
} from "./types.js";

const RPC = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

/**
 * Dropbox, scoped to the app folder.
 *
 * The app-folder permission means every path here is already relative to a
 * private `Apps/Polymux` directory — Dropbox itself enforces that the rest of the
 * user's account is out of reach, so there is no root folder to find or guard.
 */
export class DropboxDrive implements DriveAdapter {
  readonly id = "dropbox" as const;
  readonly #oauth: OAuthClient;

  constructor(
    secrets: DriveSecretStore,
    consent: DriveConsentPrompt,
    accountId?: string,
  ) {
    this.#oauth = new OAuthClient(
      this.id,
      oauthAppFromEnv(this.id, {
        authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
        tokenUrl: "https://api.dropboxapi.com/oauth2/token",
        scopes: [
          "account_info.read",
          "files.metadata.read",
          "files.content.read",
          "files.content.write",
        ],
        // Dropbox issues short-lived tokens and only sends a refresh token when
        // the flow asks for offline access explicitly.
        extraAuthParams: { token_access_type: "offline" },
      }),
      secrets,
      consent,
      accountId,
    );
  }

  async probe(): Promise<DriveProbe> {
    if (!this.#oauth.configured())
      return {
        state: "unconfigured",
        accounts: [],
        usage: null,
        root: null,
        error: "This build has no Dropbox client credentials.",
      };
    if (!(await this.#oauth.connected()))
      return {
        state: "logged-out",
        accounts: [],
        usage: null,
        root: null,
        error: null,
      };
    try {
      const [account, space] = await Promise.all([
        this.#rpc<{
          email?: string;
          name?: { display_name?: string };
          account_id?: string;
        }>("/users/get_current_account", undefined),
        this.#rpc<{
          used?: number;
          allocation?: { allocated?: number };
        }>("/users/get_space_usage", undefined),
      ]);
      return {
        state: "connected",
        accounts: [
          {
            id: account.account_id ?? "dropbox",
            name: account.name?.display_name ?? account.email ?? "Dropbox",
            email: account.email ?? null,
          },
        ],
        usage: {
          used: space.used ?? null,
          total: space.allocation?.allocated ?? null,
          appUsed: null,
        },
        root: "Apps/Polymux",
        error: null,
      };
    } catch (cause) {
      return {
        state: "error",
        accounts: [],
        usage: null,
        root: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  async connect(): Promise<void> {
    await this.#oauth.authorize();
  }

  async disconnect(): Promise<void> {
    await this.#oauth.clear();
  }

  async describe(target: string): Promise<DriveEntryDto> {
    return this.#entry(
      await this.#rpc<DropboxEntry>("/files/get_metadata", {
        path: normalize(target),
      }),
    );
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    const entries: DriveEntryDto[] = [];
    let page = await this.#rpc<DropboxPage>("/files/list_folder", {
      // Dropbox spells its root as the empty string, never "/".
      path: normalize(target),
    });
    entries.push(...page.entries.map((entry) => this.#entry(entry)));
    // A folder with more than a page of children hands back a cursor rather
    // than everything, and a drive that silently showed the first page only
    // would be worse than slow.
    while (page.has_more && page.cursor) {
      page = await this.#rpc<DropboxPage>("/files/list_folder/continue", {
        cursor: page.cursor,
      });
      entries.push(...page.entries.map((entry) => this.#entry(entry)));
    }
    return entries;
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const created = await this.#rpc<{ metadata: DropboxEntry }>(
      "/files/create_folder_v2",
      { path: join(parentPath, name), autorename: false },
    );
    return this.#entry({ ...created.metadata, [".tag"]: "folder" });
  }

  readonly conditionalWrites = true;

  childPath(parentPath: string, name: string): string {
    return join(parentPath, name);
  }

  async version(target: string): Promise<string | null> {
    try {
      const entry = await this.#rpc<DropboxEntry>("/files/get_metadata", {
        path: normalize(target),
      });
      return entry.rev ?? null;
    } catch {
      return null;
    }
  }

  async upload(
    parentPath: string,
    localPath: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const name = path.basename(localPath);
    const target = join(parentPath, name);
    const commit = {
      path: target,
      mode: options?.ifMatch
        ? { ".tag": "update", update: options.ifMatch }
        : "overwrite",
      autorename: false,
    };
    const size = (await stat(localPath)).size;
    try {
      if (size > SIMPLE_UPLOAD_LIMIT)
        return await this.#uploadSession(localPath, commit, options);

      const bytes = await readFile(localPath);
      const response = await request(
        `${CONTENT}/files/upload`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${await this.#oauth.accessToken()}`,
            "content-type": "application/octet-stream",
            // Dropbox takes content-endpoint arguments in a header, because the
            // body is the file itself.
            "dropbox-api-arg": JSON.stringify(commit),
          },
          body: new Uint8Array(bytes),
        },
        "The upload",
        this.#retry(),
      );
      const uploaded = this.#entry({
        ...((await response.json()) as DropboxEntry),
        [".tag"]: "file",
      });
      options?.onProgress?.(size, size);
      return uploaded;
    } catch (cause) {
      if (
        options?.ifMatch &&
        cause instanceof DriveRequestError &&
        cause.status === 409
      )
        throw new DriveConflictError({
          path: target,
          expected: options.ifMatch,
          found: await this.version(target),
        });
      throw cause;
    }
  }

  /**
   * An upload session: start, append, finish.
   *
   * Dropbox tracks the offset itself and rejects an append that does not match
   * with `incorrect_offset` and the offset it expects. Following that rather
   * than our own count is what makes a repeated chunk harmless — after a
   * retry, the two sides agree on where they are instead of doubling bytes.
   */
  async #uploadSession(
    localPath: string,
    commit: Record<string, unknown>,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const started = await this.#content<{ session_id: string }>(
      "/files/upload_session/start",
      { close: false },
      Buffer.alloc(0),
      "Starting the upload",
    );
    const session = started.session_id;

    return uploadInChunks(localPath, async (chunk) => {
      const cursor = { session_id: session, offset: chunk.start };
      if (chunk.last)
        return {
          done: this.#entry({
            ...(await this.#content<DropboxEntry>(
              "/files/upload_session/finish",
              { cursor, commit },
              chunk.bytes,
              "Finishing the upload",
            )),
            [".tag"]: "file",
          }),
        };
      try {
        await this.#content<unknown>(
          "/files/upload_session/append_v2",
          { cursor, close: false },
          chunk.bytes,
          "The upload",
        );
        return { resumeAt: chunk.end };
      } catch (cause) {
        const expected = incorrectOffset(cause);
        if (expected === null) throw cause;
        return { resumeAt: expected };
      }
    }, "The upload", options?.onProgress);
  }

  async download(target: string, destination: string): Promise<void> {
    await downloadToFile(destination, {
      // Dropbox returns the metadata in a header on the download itself, so
      // the size and hash cost no extra call.
      describe: (response) => {
        const result = response.headers.get("dropbox-api-result");
        if (!result) return {};
        try {
          const meta = JSON.parse(result) as {
            size?: number;
            content_hash?: string;
          };
          return {
            size: typeof meta.size === "number" ? meta.size : null,
            hash: meta.content_hash
              ? { algorithm: "dropbox", expected: meta.content_hash }
              : null,
          };
        } catch {
          return {};
        }
      },
      open: async (offset) =>
        request(
          `${CONTENT}/files/download`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${await this.#oauth.accessToken()}`,
              "dropbox-api-arg": JSON.stringify({ path: normalize(target) }),
              ...(offset > 0 ? { range: `bytes=${offset}-` } : {}),
            },
          },
          "The download",
          this.#retry(),
        ),
    });
  }

  async remove(target: string): Promise<void> {
    await this.#rpc<unknown>("/files/delete_v2", { path: normalize(target) });
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const from = normalize(target);
    const parent = from.slice(0, from.lastIndexOf("/"));
    const moved = await this.#rpc<{ metadata: DropboxEntry }>(
      "/files/move_v2",
      {
        from_path: from,
        to_path: join(parent, name),
        autorename: false,
      },
    );
    return this.#entry(moved.metadata);
  }

  async move(
    target: string,
    destinationFolder: string,
  ): Promise<DriveEntryDto> {
    const from = normalize(target);
    const moved = await this.#rpc<{ metadata: DropboxEntry }>(
      "/files/move_v2",
      {
        from_path: from,
        to_path: join(destinationFolder, from.slice(from.lastIndexOf("/") + 1)),
        autorename: true,
      },
    );
    return this.#entry(moved.metadata);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const from = normalize(target);
    const parent = from.slice(0, from.lastIndexOf("/"));
    const copied = await this.#rpc<{ metadata: DropboxEntry }>(
      "/files/copy_v2",
      {
        from_path: from,
        to_path: join(parent, copyName(from.slice(from.lastIndexOf("/") + 1))),
        autorename: true,
      },
    );
    return this.#entry(copied.metadata);
  }

  #entry(entry: DropboxEntry): DriveEntryDto {
    const folder = entry[".tag"] === "folder";
    const location = entry.path_lower ?? entry.path_display ?? "";
    return {
      id: entry.id ?? location,
      name: entry.name,
      kind: folder ? "folder" : "file",
      size: folder ? null : (entry.size ?? null),
      modifiedAt: entry.server_modified ?? entry.client_modified ?? null,
      provider: this.id,
      path: location,
      mimeType: null,
      // Dropbox has no link on the metadata: a shared link is a separate call
      // that *creates* one, which is not something opening a file should do.
      // Its web app addresses files by path under /home, so that is built here
      // rather than asking the API to publish anything.
      webUrl: location
        ? `https://www.dropbox.com/home${encodeURI(location)}`
        : null,
      version: entry.rev ?? null,
    };
  }

  /**
   * Dropbox's RPC endpoints take a JSON body — except the argument-less ones,
   * which reject a request that carries a content type at all.
   */
  async #rpc<T>(suffix: string, body?: Record<string, unknown>): Promise<T> {
    return jsonRequest<T>(
      `${RPC}${suffix}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      "The Dropbox request",
      this.#retry(),
    );
  }

  /** A content endpoint: arguments in the header, bytes in the body. */
  async #content<T>(
    suffix: string,
    arg: Record<string, unknown>,
    bytes: Buffer,
    label: string,
  ): Promise<T> {
    const response = await request(
      `${CONTENT}${suffix}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": "application/octet-stream",
          "dropbox-api-arg": JSON.stringify(arg),
        },
        body: new Uint8Array(bytes),
      },
      label,
      this.#retry(),
    );
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Dropbox's retry policy.
   *
   * It answers a rate limit with 429 like everyone else, but states the wait
   * in the JSON body rather than in `Retry-After` — so without this hook the
   * backoff would guess when the provider has already said.
   */
  #retry(): RequestOptions {
    return {
      retryAfter: (status, body) => (status === 429 ? retryAfter(body) : null),
    };
  }
}

function retryAfter(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { error?: { retry_after?: number } };
    const seconds = parsed.error?.retry_after;
    return typeof seconds === "number" ? seconds : null;
  } catch {
    return null;
  }
}

/** The offset Dropbox says the session is really at, when an append lands in
 * the wrong place. Anything else is a failure that resuming cannot fix. */
function incorrectOffset(cause: unknown): number | null {
  if (!(cause instanceof DriveRequestError) || cause.status !== 409)
    return null;
  try {
    const parsed = JSON.parse(cause.body) as {
      error?: {
        ".tag"?: string;
        correct_offset?: number;
        incorrect_offset?: { correct_offset?: number };
      };
    };
    const offset =
      parsed.error?.correct_offset ??
      parsed.error?.incorrect_offset?.correct_offset;
    return typeof offset === "number" ? offset : null;
  } catch {
    return null;
  }
}

interface DropboxEntry {
  ".tag"?: string;
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
  client_modified?: string;
  rev?: string;
}

interface DropboxPage {
  entries: DropboxEntry[];
  cursor?: string;
  has_more?: boolean;
}

/** The app-folder root is `""`; everything else keeps a single leading slash. */
function normalize(target: string): string {
  if (!target || target === "/") return "";
  return target.startsWith("/") ? target : `/${target}`;
}

function join(parent: string, name: string): string {
  return `${normalize(parent)}/${name}`;
}
