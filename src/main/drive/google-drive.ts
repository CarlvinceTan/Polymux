import {readFile} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto} from "@midas/protocol";
import {jsonRequest, requestError, streamToFile} from "./http.js";
import {OAuthClient, oauthAppFromEnv} from "./oauth.js";
import {copyName, type DriveAdapter, type DriveProbe, type DriveSecretStore} from "./types.js";
import type {BrowserWindow} from "electron";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** The folder Midas keeps its files in. Visible in the user's Drive on
 * purpose: files an agent made should be findable without Midas. */
const ROOT_FOLDER_NAME = "Midas";
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime";

/**
 * Google Drive.
 *
 * Only files Midas creates are in scope — the `drive.file` scope means the app
 * can never read the rest of the user's Drive, which is both the least
 * surprising behaviour and the least it can ask for.
 */
export class GoogleDrive implements DriveAdapter {
  readonly id = "google-drive" as const;
  readonly #oauth: OAuthClient;
  /** The `Midas` folder's id, looked up once per connection. */
  #rootId: string | null = null;

  constructor(secrets: DriveSecretStore, parent: () => BrowserWindow | undefined) {
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
      parent,
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
      return {state: "logged-out", accounts: [], usage: null, root: null, error: null};
    try {
      const about = await this.#get<{
        user?: {emailAddress?: string; displayName?: string};
        storageQuota?: {usage?: string; limit?: string};
      }>("/about?fields=user,storageQuota");
      return {
        state: "connected",
        accounts: [
          {
            id: about.user?.emailAddress ?? "google-drive",
            name: about.user?.displayName ?? about.user?.emailAddress ?? "Google Drive",
            email: about.user?.emailAddress ?? null,
          },
        ],
        usage: {
          used: numeric(about.storageQuota?.usage),
          // Unlimited accounts report no limit at all, which is a real answer
          // rather than a missing one.
          total: numeric(about.storageQuota?.limit),
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
  }

  async disconnect(): Promise<void> {
    await this.#oauth.clear();
    this.#rootId = null;
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    const parent = target || (await this.#root());
    const query = encodeURIComponent(
      `'${parent}' in parents and trashed = false`,
    );
    const page = await this.#get<{files?: GoogleFile[]}>(
      `/files?q=${query}&fields=files(${FILE_FIELDS})&pageSize=1000&orderBy=folder,name`,
    );
    return (page.files ?? []).map((file) => this.#entry(file));
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const parent = parentPath || (await this.#root());
    const file = await this.#json<GoogleFile>(
      `/files?fields=${FILE_FIELDS}`,
      {
        method: "POST",
        body: JSON.stringify({name, mimeType: FOLDER_MIME, parents: [parent]}),
      },
      "Creating the folder",
    );
    return this.#entry(file);
  }

  async upload(parentPath: string, localPath: string): Promise<DriveEntryDto> {
    const parent = parentPath || (await this.#root());
    const name = path.basename(localPath);
    const bytes = await readFile(localPath);
    // A multipart upload sends the metadata and the bytes in one request,
    // which is what keeps a new file from ever existing without its name.
    const boundary = `midas-${Date.now().toString(36)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          {name, parents: [parent]},
        )}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await fetch(
      `${UPLOAD_API}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      },
    );
    if (!response.ok) throw await requestError(response, "The upload");
    return this.#entry((await response.json()) as GoogleFile);
  }

  async download(target: string, destination: string): Promise<void> {
    const response = await fetch(`${API}/files/${target}?alt=media`, {
      headers: {authorization: `Bearer ${await this.#oauth.accessToken()}`},
    });
    if (!response.ok) throw await requestError(response, "The download");
    await streamToFile(response, destination);
  }

  async remove(target: string): Promise<void> {
    await this.#json<void>(
      `/files/${target}`,
      {method: "DELETE"},
      "Deleting the file",
    );
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const file = await this.#json<GoogleFile>(
      `/files/${target}?fields=${FILE_FIELDS}`,
      {method: "PATCH", body: JSON.stringify({name})},
      "Renaming the file",
    );
    return this.#entry(file);
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    const parent = destinationFolder || (await this.#root());
    // Drive files can sit in several folders at once, so a move is stated as
    // the parents to add and the ones to drop rather than as a new location.
    const current = await this.#get<{parents?: string[]}>(
      `/files/${target}?fields=parents`,
    );
    const removing = (current.parents ?? []).join(",");
    const file = await this.#json<GoogleFile>(
      `/files/${target}?addParents=${parent}${
        removing ? `&removeParents=${removing}` : ""
      }&fields=${FILE_FIELDS}`,
      {method: "PATCH", body: JSON.stringify({})},
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
      {method: "POST", body: JSON.stringify({name: copyName(original.name)})},
      "Duplicating the file",
    );
    return this.#entry(file);
  }

  /** Finds the `Midas` folder, creating it the first time. */
  async #root(): Promise<string> {
    if (this.#rootId) return this.#rootId;
    const query = encodeURIComponent(
      `name = '${ROOT_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    );
    const found = await this.#get<{files?: GoogleFile[]}>(
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
      "Creating the Midas folder",
    );
    this.#rootId = created.id;
    return created.id;
  }

  #entry(file: GoogleFile): DriveEntryDto {
    const folder = file.mimeType === FOLDER_MIME;
    return {
      id: file.id,
      name: file.name,
      kind: folder ? "folder" : "file",
      size: folder ? null : numeric(file.size),
      modifiedAt: file.modifiedTime ?? null,
      provider: this.id,
      path: file.id,
      mimeType: folder ? null : (file.mimeType ?? null),
    };
  }

  async #get<T>(suffix: string): Promise<T> {
    return this.#json<T>(suffix, {method: "GET"}, "The Google Drive request");
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
    );
  }
}

interface GoogleFile {
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
