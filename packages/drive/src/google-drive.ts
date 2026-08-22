import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DriveEntryDto } from "@flareai/protocol";
import { contentRange, SIMPLE_UPLOAD_LIMIT, uploadInChunks } from "./chunks.js";
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

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** The folder FlareAI keeps its files in. Visible in the user's Drive on
 * purpose: files an agent made should be findable without FlareAI. */
const ROOT_FOLDER_NAME = "FlareAI";
// `webViewLink` is what "open where it lives" needs: Drive's own page for
// the file, which is the only address that works for a Workspace document.
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink";

/**
 * Google Drive.
 *
 * Only files FlareAI creates are in scope — the `drive.file` scope means the app
 * can never read the rest of the user's Drive, which is both the least
 * surprising behaviour and the least it can ask for.
 */
export class GoogleDrive implements DriveAdapter {
  readonly id = "google-drive" as const;
  readonly #oauth: OAuthClient;
  /** The `FlareAI` folder's id, looked up once per connection. */
  #rootId: string | null = null;
  /** The lookup while it is in flight. Shared, because two uploads starting
   * together would otherwise each fail to find the folder and each create
   * one — Drive allows duplicate names, so nothing downstream would notice. */
  #rootLookup: Promise<string> | null = null;

  constructor(
    secrets: DriveSecretStore,
    consent: DriveConsentPrompt,
    accountId?: string,
  ) {
    this.#oauth = new OAuthClient(
      this.id,
      oauthAppFromEnv(this.id, {
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/userinfo.email",
        ],
        extraAuthParams: {
          // Without both of these Google issues no refresh token on a repeat
          // consent, and the connection silently dies an hour later.
          access_type: "offline",
          prompt: "consent",
        },
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
        error: "This build has no Google Drive client credentials.",
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
      const about = await this.#get<{
        user?: { emailAddress?: string; displayName?: string };
        storageQuota?: { usage?: string; limit?: string };
      }>("/about?fields=user,storageQuota");
      return {
        state: "connected",
        accounts: [
          {
            id: about.user?.emailAddress ?? "google-drive",
            name:
              about.user?.displayName ??
              about.user?.emailAddress ??
              "Google Drive",
            email: about.user?.emailAddress ?? null,
          },
        ],
        usage: {
          used: numeric(about.storageQuota?.usage),
          // Unlimited accounts report no limit at all, which is a real answer
          // rather than a missing one.
          total: numeric(about.storageQuota?.limit),
          appUsed: null,
        },
        root: ROOT_FOLDER_NAME,
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
    this.#rootId = null;
    this.#rootLookup = null;
  }

  async disconnect(): Promise<void> {
    await this.#oauth.clear();
    this.#rootId = null;
    this.#rootLookup = null;
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    const parent = target || (await this.#root());
    const query = encodeURIComponent(
      `'${parent}' in parents and trashed = false`,
    );
    const entries: DriveEntryDto[] = [];
    let token: string | undefined;
    // Drive caps a page well below what a folder can hold, and answers with a
    // token rather than an error — so a listing that read one page would drop
    // the rest of the folder without ever saying so.
    do {
      const page = await this.#get<{
        files?: GoogleFile[];
        nextPageToken?: string;
      }>(
        `/files?q=${query}&fields=nextPageToken,files(${FILE_FIELDS})&pageSize=1000&orderBy=folder,name${
          token ? `&pageToken=${encodeURIComponent(token)}` : ""
        }`,
      );
      entries.push(...(page.files ?? []).map((file) => this.#entry(file)));
      token = page.nextPageToken;
    } while (token);
    return entries;
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const parent = parentPath || (await this.#root());
    const file = await this.#json<GoogleFile>(
      `/files?fields=${FILE_FIELDS}`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          parents: [parent],
        }),
      },
      "Creating the folder",
    );
    return this.#entry(file);
  }

  readonly conditionalWrites = true;

  childPath(parentPath: string, name: string): string {
    return `${parentPath}/${name}`;
  }

  async existingChild(
    parentPath: string,
    name: string,
  ): Promise<string | null> {
    const parent = parentPath || (await this.#root());
    return (await this.#named(parent, name))?.id ?? null;
  }

  async version(target: string): Promise<string | null> {
    try {
      const response = await request(
        `${API}/files/${target}?fields=id`,
        {
          headers: {
            authorization: `Bearer ${await this.#oauth.accessToken()}`,
          },
        },
        "Reading the file version",
        this.#retry(),
      );
      await response.body?.cancel();
      return response.headers.get("etag");
    } catch {
      return null;
    }
  }

  async upload(
    parentPath: string,
    localPath: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const parent = parentPath || (await this.#root());
    const name = path.basename(localPath);
    const existing = await this.#named(parent, name);
    if (options?.ifMatch && !existing)
      throw new DriveConflictError({
        path: `${parentPath}/${name}`,
        expected: options.ifMatch,
        found: null,
      });
    const metadata = existing ? { name } : { name, parents: [parent] };
    const size = (await stat(localPath)).size;
    if (size > SIMPLE_UPLOAD_LIMIT)
      return this.#withConflict(
        `${parentPath}/${name}`,
        options?.ifMatch,
        existing?.id,
        () =>
          this.#uploadResumable(
            localPath,
            metadata,
            size,
            existing?.id,
            options,
          ),
      );

    const bytes = await readFile(localPath);
    // A multipart upload sends the metadata and the bytes in one request,
    // which is what keeps a new file from ever existing without its name.
    const boundary = `flareai-${Date.now().toString(36)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          metadata,
        )}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await this.#withConflict(
      `${parentPath}/${name}`,
      options?.ifMatch,
      existing?.id,
      async () =>
        request(
          `${UPLOAD_API}/files${existing ? `/${existing.id}` : ""}?uploadType=multipart&fields=${FILE_FIELDS}`,
          {
            method: existing ? "PATCH" : "POST",
            headers: {
              authorization: `Bearer ${await this.#oauth.accessToken()}`,
              "content-type": `multipart/related; boundary=${boundary}`,
              ...(options?.ifMatch ? { "if-match": options.ifMatch } : {}),
            },
            body: new Uint8Array(body),
          },
          "The upload",
          this.#retry(),
        ),
    );
    const file = this.#entry((await response.json()) as GoogleFile);
    options?.onProgress?.(size, size);
    return { ...file, version: response.headers.get("etag") };
  }

  /**
   * A resumable upload: one session, then the file a chunk at a time.
   *
   * Drive answers each incomplete chunk with 308 and the range it actually
   * holds. Trusting that over our own count is what makes a retried chunk
   * safe — a chunk the server already took is not sent twice, so a flaky
   * connection costs time rather than a corrupt file.
   */
  async #uploadResumable(
    localPath: string,
    metadata: Record<string, unknown>,
    size: number,
    existingId?: string,
    options?: DriveWriteOptions,
  ): Promise<DriveEntryDto> {
    const opened = await request(
      `${UPLOAD_API}/files${existingId ? `/${existingId}` : ""}?uploadType=resumable&fields=${FILE_FIELDS}`,
      {
        method: existingId ? "PATCH" : "POST",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(size),
          ...(options?.ifMatch ? { "if-match": options.ifMatch } : {}),
        },
        body: JSON.stringify(metadata),
      },
      "Starting the upload",
      this.#retry(),
    );
    const session = opened.headers.get("location");
    if (!session) throw new Error("Google Drive did not open an upload.");

    return uploadInChunks(localPath, async (chunk) => {
      const response = await request(
        session,
        {
          method: "PUT",
          headers: {
            "content-length": String(chunk.end - chunk.start),
            "content-range": contentRange(chunk),
          },
          body: new Uint8Array(chunk.bytes),
        },
        "The upload",
        // 308 is how Drive says "still going" — an answer, not a failure.
        { ...this.#retry(), accept: [308] },
      );
      if (response.status !== 308)
        return {
          done: {
            ...this.#entry((await response.json()) as GoogleFile),
            version: response.headers.get("etag"),
          },
        };
      return { resumeAt: committedOffset(response) ?? chunk.end };
    }, "The upload", options?.onProgress);
  }

  async #named(parent: string, name: string): Promise<GoogleFile | null> {
    const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = encodeURIComponent(
      `name = '${escaped}' and '${parent}' in parents and trashed = false`,
    );
    const found = await this.#get<{ files?: GoogleFile[] }>(
      `/files?q=${query}&fields=files(${FILE_FIELDS})&pageSize=1`,
    );
    return found.files?.[0] ?? null;
  }

  async #withConflict<T>(
    target: string,
    expected: string | null | undefined,
    existingId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (cause) {
      if (
        expected &&
        cause instanceof DriveRequestError &&
        (cause.status === 409 || cause.status === 412)
      )
        throw new DriveConflictError({
          path: target,
          expected,
          found: existingId ? await this.version(existingId) : null,
        });
      throw cause;
    }
  }

  async describe(target: string): Promise<DriveEntryDto> {
    return this.#entry(
      await this.#get<GoogleFile>(`/files/${target}?fields=${FILE_FIELDS}`),
    );
  }

  async download(target: string, destination: string): Promise<void> {
    // Drive states both up front, so what the file should be is known before
    // a byte of it arrives. Google Docs and the like report neither, which is
    // an honest absence rather than a missing check.
    const about = await this.#get<{
      size?: string;
      md5Checksum?: string;
      mimeType?: string;
    }>(`/files/${target}?fields=size,md5Checksum,mimeType`);

    // A Doc, Sheet or Slide has no bytes of its own: `alt=media` is only for
    // blob files and refuses these, so Drive converts one on the way out. The
    // result is generated per request, so there is no size or hash to check it
    // against — an honest absence rather than a skipped verification.
    const exported = exportFormat(about.mimeType);
    if (exported) {
      await downloadToFile(destination, {
        open: async () =>
          request(
            `${API}/files/${target}/export?mimeType=${encodeURIComponent(
              exported.mimeType,
            )}`,
            {
              headers: {
                authorization: `Bearer ${await this.#oauth.accessToken()}`,
              },
            },
            "The download",
            this.#retry(),
          ),
      });
      return;
    }
    await downloadToFile(destination, {
      expect: {
        size: numeric(about.size),
        hash: about.md5Checksum
          ? { algorithm: "md5", expected: about.md5Checksum }
          : null,
      },
      open: async (offset) =>
        request(
          `${API}/files/${target}?alt=media`,
          {
            headers: {
              authorization: `Bearer ${await this.#oauth.accessToken()}`,
              ...(offset > 0 ? { range: `bytes=${offset}-` } : {}),
            },
          },
          "The download",
          this.#retry(),
        ),
    });
  }

  async remove(target: string): Promise<void> {
    await this.#json<void>(
      `/files/${target}`,
      { method: "DELETE" },
      "Deleting the file",
    );
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const file = await this.#json<GoogleFile>(
      `/files/${target}?fields=${FILE_FIELDS}`,
      { method: "PATCH", body: JSON.stringify({ name }) },
      "Renaming the file",
    );
    return this.#entry(file);
  }

  async move(
    target: string,
    destinationFolder: string,
  ): Promise<DriveEntryDto> {
    const parent = destinationFolder || (await this.#root());
    // Drive files can sit in several folders at once, so a move is stated as
    // the parents to add and the ones to drop rather than as a new location.
    const current = await this.#get<{ parents?: string[] }>(
      `/files/${target}?fields=parents`,
    );
    const removing = (current.parents ?? []).join(",");
    const file = await this.#json<GoogleFile>(
      `/files/${target}?addParents=${parent}${
        removing ? `&removeParents=${removing}` : ""
      }&fields=${FILE_FIELDS}`,
      { method: "PATCH", body: JSON.stringify({}) },
      "Moving the file",
    );
    return this.#entry(file);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const original = await this.#get<GoogleFile>(
      `/files/${target}?fields=${FILE_FIELDS}`,
    );
    if (original.mimeType === FOLDER_MIME)
      throw new Error("Google Drive cannot duplicate a folder.");
    const file = await this.#json<GoogleFile>(
      `/files/${target}/copy?fields=${FILE_FIELDS}`,
      {
        method: "POST",
        body: JSON.stringify({ name: copyName(original.name) }),
      },
      "Duplicating the file",
    );
    return this.#entry(file);
  }

  /** Finds the `FlareAI` folder, creating it the first time. */
  async #root(): Promise<string> {
    if (this.#rootId) return this.#rootId;
    this.#rootLookup ??= this.#findOrCreateRoot().finally(() => {
      this.#rootLookup = null;
    });
    return this.#rootLookup;
  }

  async #findOrCreateRoot(): Promise<string> {
    const query = encodeURIComponent(
      `name = '${ROOT_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    );
    const found = await this.#get<{ files?: GoogleFile[] }>(
      `/files?q=${query}&fields=files(id)&pageSize=1`,
    );
    const existing = found.files?.[0]?.id;
    if (existing) {
      this.#rootId = existing;
      return existing;
    }
    const created = await this.#json<GoogleFile>(
      "/files?fields=id",
      {
        method: "POST",
        body: JSON.stringify({
          name: ROOT_FOLDER_NAME,
          mimeType: FOLDER_MIME,
          parents: ["root"],
        }),
      },
      "Creating the FlareAI folder",
    );
    this.#rootId = created.id;
    return created.id;
  }

  #entry(file: GoogleFile): DriveEntryDto {
    const folder = file.mimeType === FOLDER_MIME;
    const exported = exportFormat(file.mimeType);
    return {
      id: file.id,
      // A Workspace document downloads as its converted form, so its name
      // carries the extension it will actually have on disk. Without this a
      // spreadsheet saves as "Q3 figures" and opens in nothing.
      name: exported ? `${file.name}${exported.extension}` : file.name,
      kind: folder ? "folder" : "file",
      size: folder ? null : numeric(file.size),
      modifiedAt: file.modifiedTime ?? null,
      provider: this.id,
      path: file.id,
      mimeType: folder ? null : (file.mimeType ?? null),
      webUrl: file.webViewLink ?? null,
    };
  }

  /**
   * Drive's retry policy.
   *
   * The part that is not obvious from the status: Drive reports rate limiting
   * as a **403**, with the reason buried in the body, and its own error guide
   * says to back off on those. Treating every 403 as permission-denied is what
   * turns a busy minute into "the drive is broken"; treating every 403 as
   * retryable would sit in a loop on a genuinely revoked token or a full
   * account, so the reason is what decides.
   */
  #retry(): RequestOptions {
    return {
      retryable: (status, body) =>
        status === 403 && RETRYABLE_REASONS.has(driveReason(body) ?? ""),
    };
  }

  async #get<T>(suffix: string): Promise<T> {
    return this.#json<T>(suffix, { method: "GET" }, "The Google Drive request");
  }

  async #json<T>(suffix: string, init: RequestInit, label: string): Promise<T> {
    return jsonRequest<T>(
      `${API}${suffix}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      },
      label,
      this.#retry(),
    );
  }
}

/**
 * What a Google Workspace document turns into on the way out.
 *
 * The choice is the editable equivalent rather than PDF: a user downloading a
 * Sheet almost always wants to keep working on it, and a PDF of a spreadsheet
 * is a different thing from the spreadsheet. Anything without a mapping — a
 * Form, a Site — has no sensible file form and is left to fail with Drive's
 * own message rather than being silently turned into something else.
 */
const EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx",
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "application/pdf",
    extension: ".pdf",
  },
  "application/vnd.google-apps.script": {
    mimeType: "application/vnd.google-apps.script+json",
    extension: ".json",
  },
};

function exportFormat(
  mimeType: string | undefined,
): { mimeType: string; extension: string } | null {
  return mimeType ? (EXPORTS[mimeType] ?? null) : null;
}

/**
 * The 403 reasons that mean "too fast", as against the ones that mean "no".
 * `storageQuotaExceeded` is the one that must stay out: the account is full,
 * and retrying it is a loop that can never come good.
 */
const RETRYABLE_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "sharingRateLimitExceeded",
  "backendError",
  "internalError",
]);

function driveReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[]; status?: string };
    };
    return parsed.error?.errors?.[0]?.reason ?? null;
  } catch {
    return null;
  }
}

/** What a 308 says it already holds: `Range: bytes=0-786431` means the next
 * chunk starts at 786432. An absent range means it holds nothing yet. */
function committedOffset(response: Response): number | null {
  const range = response.headers.get("range");
  const end = range?.match(/bytes=\d+-(\d+)/)?.[1];
  return end === undefined ? null : Number(end) + 1;
}

interface GoogleFile {
  /** Drive's own page for the file, requested in FILE_FIELDS. */
  webViewLink?: string;
  id: string;
  name: string;
  mimeType?: string;
  /** Google sends sizes as strings, because they can exceed 2^53. */
  size?: string;
  modifiedTime?: string;
}

function numeric(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
