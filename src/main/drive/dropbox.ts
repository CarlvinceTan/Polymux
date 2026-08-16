import {readFile} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto} from "@flareai/protocol";
import {jsonRequest, requestError, streamToFile} from "./http.js";
import {OAuthClient, oauthAppFromEnv} from "./oauth.js";
import {copyName, type DriveAdapter, type DriveProbe, type DriveSecretStore} from "./types.js";
import type {BrowserWindow} from "electron";

const RPC = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

/**
 * Dropbox, scoped to the app folder.
 *
 * The app-folder permission means every path here is already relative to a
 * private `Apps/FlareAI` directory — Dropbox itself enforces that the rest of the
 * user's account is out of reach, so there is no root folder to find or guard.
 */
export class DropboxDrive implements DriveAdapter {
  readonly id = "dropbox" as const;
  readonly #oauth: OAuthClient;

  constructor(secrets: DriveSecretStore, parent: () => BrowserWindow | undefined) {
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
        extraAuthParams: {token_access_type: "offline"},
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
        error: "This build has no Dropbox client credentials.",
      };
    if (!(await this.#oauth.connected()))
      return {state: "logged-out", accounts: [], usage: null, root: null, error: null};
    try {
      const [account, space] = await Promise.all([
        this.#rpc<{
          email?: string;
          name?: {display_name?: string};
          account_id?: string;
        }>("/users/get_current_account", undefined),
        this.#rpc<{
          used?: number;
          allocation?: {allocated?: number};
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
        },
        root: "Apps/FlareAI",
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
    const created = await this.#rpc<{metadata: DropboxEntry}>(
      "/files/create_folder_v2",
      {path: join(parentPath, name), autorename: false},
    );
    return this.#entry({...created.metadata, [".tag"]: "folder"});
  }

  async upload(parentPath: string, localPath: string): Promise<DriveEntryDto> {
    const name = path.basename(localPath);
    const bytes = await readFile(localPath);
    const response = await fetch(`${CONTENT}/files/upload`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.#oauth.accessToken()}`,
        "content-type": "application/octet-stream",
        // Dropbox takes content-endpoint arguments in a header, because the
        // body is the file itself.
        "dropbox-api-arg": JSON.stringify({
          path: join(parentPath, name),
          mode: "add",
          autorename: true,
        }),
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw await requestError(response, "The upload");
    return this.#entry({
      ...((await response.json()) as DropboxEntry),
      [".tag"]: "file",
    });
  }

  async download(target: string, destination: string): Promise<void> {
    const response = await fetch(`${CONTENT}/files/download`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.#oauth.accessToken()}`,
        "dropbox-api-arg": JSON.stringify({path: normalize(target)}),
      },
    });
    if (!response.ok) throw await requestError(response, "The download");
    await streamToFile(response, destination);
  }

  async remove(target: string): Promise<void> {
    await this.#rpc<unknown>("/files/delete_v2", {path: normalize(target)});
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const from = normalize(target);
    const parent = from.slice(0, from.lastIndexOf("/"));
    const moved = await this.#rpc<{metadata: DropboxEntry}>("/files/move_v2", {
      from_path: from,
      to_path: join(parent, name),
      autorename: false,
    });
    return this.#entry(moved.metadata);
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    const from = normalize(target);
    const moved = await this.#rpc<{metadata: DropboxEntry}>("/files/move_v2", {
      from_path: from,
      to_path: join(destinationFolder, from.slice(from.lastIndexOf("/") + 1)),
      autorename: true,
    });
    return this.#entry(moved.metadata);
  }

  async copy(target: string): Promise<DriveEntryDto> {
    const from = normalize(target);
    const parent = from.slice(0, from.lastIndexOf("/"));
    const copied = await this.#rpc<{metadata: DropboxEntry}>("/files/copy_v2", {
      from_path: from,
      to_path: join(parent, copyName(from.slice(from.lastIndexOf("/") + 1))),
      autorename: true,
    });
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
          ...(body ? {"content-type": "application/json"} : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      "The Dropbox request",
    );
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
