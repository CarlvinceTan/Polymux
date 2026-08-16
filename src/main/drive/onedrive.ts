import {readFile} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto} from "@flareai/protocol";
import {jsonRequest, requestError, streamToFile} from "./http.js";
import {OAuthClient, oauthAppFromEnv} from "./oauth.js";
import {copyName, type DriveAdapter, type DriveProbe, type DriveSecretStore} from "./types.js";
import type {BrowserWindow} from "electron";

const GRAPH = "https://graph.microsoft.com/v1.0";
const ITEM_FIELDS = "id,name,size,lastModifiedDateTime,folder,file";

/**
 * OneDrive, through Microsoft Graph.
 *
 * Like Dropbox this uses the app-folder permission, so FlareAI can only ever see
 * its own directory. The `common` tenant is used so personal and work accounts
 * both sign in through the same flow.
 */
export class OneDrive implements DriveAdapter {
  readonly id = "onedrive" as const;
  readonly #oauth: OAuthClient;
  /** The app folder's item id, looked up once per connection. */
  #rootId: string | null = null;

  constructor(secrets: DriveSecretStore, parent: () => BrowserWindow | undefined) {
    this.#oauth = new OAuthClient(
      this.id,
      oauthAppFromEnv(this.id, {
        authorizeUrl:
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        // Graph only issues a refresh token when offline_access is among the
        // scopes; it is a scope here rather than a flag as it is elsewhere.
        scopes: ["offline_access", "User.Read", "Files.ReadWrite.AppFolder"],
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
        error: "This build has no OneDrive client credentials.",
      };
    if (!(await this.#oauth.connected()))
      return {state: "logged-out", accounts: [], usage: null, root: null, error: null};
    try {
      const [me, drive] = await Promise.all([
        this.#get<{
          id?: string;
          displayName?: string;
          userPrincipalName?: string;
          mail?: string;
        }>("/me"),
        this.#get<{quota?: {used?: number; total?: number}}>("/me/drive"),
      ]);
      const email = me.mail ?? me.userPrincipalName ?? null;
      return {
        state: "connected",
        accounts: [
          {
            id: me.id ?? "onedrive",
            name: me.displayName ?? email ?? "OneDrive",
            email,
          },
        ],
        usage: {
          used: drive.quota?.used ?? null,
          total: drive.quota?.total ?? null,
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
    this.#rootId = null;
  }

  async disconnect(): Promise<void> {
    await this.#oauth.clear();
    this.#rootId = null;
  }

  async list(target: string): Promise<DriveEntryDto[]> {
    const entries: DriveEntryDto[] = [];
    let url: string | undefined = `${GRAPH}/me/drive/items/${await this.#item(
      target,
    )}/children?$select=${ITEM_FIELDS}&$top=200`;
    while (url) {
      const page: GraphPage = await this.#json<GraphPage>(
        url,
        {method: "GET"},
        "The OneDrive request",
      );
      entries.push(...(page.value ?? []).map((item) => this.#entry(item)));
      // Graph paginates with an absolute next link rather than a cursor.
      url = page["@odata.nextLink"];
    }
    return entries;
  }

  async createFolder(parentPath: string, name: string): Promise<DriveEntryDto> {
    const item = await this.#json<GraphItem>(
      `${GRAPH}/me/drive/items/${await this.#item(parentPath)}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      },
      "Creating the folder",
    );
    return this.#entry(item);
  }

  async upload(parentPath: string, localPath: string): Promise<DriveEntryDto> {
    const name = path.basename(localPath);
    const bytes = await readFile(localPath);
    const response = await fetch(
      `${GRAPH}/me/drive/items/${await this.#item(
        parentPath,
      )}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      },
    );
    if (!response.ok) throw await requestError(response, "The upload");
    return this.#entry((await response.json()) as GraphItem);
  }

  async download(target: string, destination: string): Promise<void> {
    const response = await fetch(`${GRAPH}/me/drive/items/${target}/content`, {
      headers: {authorization: `Bearer ${await this.#oauth.accessToken()}`},
    });
    if (!response.ok) throw await requestError(response, "The download");
    await streamToFile(response, destination);
  }

  async remove(target: string): Promise<void> {
    await this.#json<void>(
      `${GRAPH}/me/drive/items/${target}`,
      {method: "DELETE"},
      "Deleting the file",
    );
  }

  async rename(target: string, name: string): Promise<DriveEntryDto> {
    const item = await this.#json<GraphItem>(
      `${GRAPH}/me/drive/items/${target}`,
      {method: "PATCH", body: JSON.stringify({name})},
      "Renaming the file",
    );
    return this.#entry(item);
  }

  async move(target: string, destinationFolder: string): Promise<DriveEntryDto> {
    const item = await this.#json<GraphItem>(
      `${GRAPH}/me/drive/items/${target}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          parentReference: {id: await this.#item(destinationFolder)},
        }),
      },
      "Moving the file",
    );
    return this.#entry(item);
  }

  /**
   * Graph copies asynchronously: the POST returns 202 with a monitor URL, and
   * the new item does not exist until that job reports success. Returning
   * before it does would hand back an id nothing can open yet.
   */
  async copy(target: string): Promise<DriveEntryDto> {
    const original = await this.#get<GraphItem & {parentReference?: {id?: string}}>(
      `/me/drive/items/${target}?$select=${ITEM_FIELDS},parentReference`,
    );
    const response = await fetch(`${GRAPH}/me/drive/items/${target}/copy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.#oauth.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: copyName(original.name),
        ...(original.parentReference?.id
          ? {parentReference: {id: original.parentReference.id}}
          : {}),
      }),
    });
    if (!response.ok) throw await requestError(response, "Duplicating the file");
    const monitor = response.headers.get("location");
    if (!monitor)
      throw new Error("OneDrive did not report where the copy was going.");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      // The monitor URL is pre-authenticated and rejects an Authorization
      // header, so this one request deliberately goes out bare.
      type CopyStatus = {status?: string; resourceId?: string};
      const status: CopyStatus = await fetch(monitor).then(
        (result) => result.json() as Promise<CopyStatus>,
        (): CopyStatus => ({}),
      );
      if (status.status === "completed" && status.resourceId)
        return this.#entry(
          await this.#get<GraphItem>(
            `/me/drive/items/${status.resourceId}?$select=${ITEM_FIELDS}`,
          ),
        );
      if (status.status === "failed")
        throw new Error("OneDrive could not duplicate the file.");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("OneDrive is still duplicating the file. Refresh shortly.");
  }

  /** An empty path means the app folder, which has to be resolved to an id
   * before it can be addressed like any other item. */
  async #item(target: string): Promise<string> {
    if (target) return target;
    if (this.#rootId) return this.#rootId;
    // Requesting the special folder creates it if this is the first time.
    const root = await this.#get<GraphItem>("/me/drive/special/approot");
    this.#rootId = root.id;
    return root.id;
  }

  #entry(item: GraphItem): DriveEntryDto {
    const folder = item.folder !== undefined;
    return {
      id: item.id,
      name: item.name,
      kind: folder ? "folder" : "file",
      size: folder ? null : (item.size ?? null),
      modifiedAt: item.lastModifiedDateTime ?? null,
      provider: this.id,
      path: item.id,
      mimeType: item.file?.mimeType ?? null,
    };
  }

  async #get<T>(suffix: string): Promise<T> {
    return this.#json<T>(
      `${GRAPH}${suffix}`,
      {method: "GET"},
      "The OneDrive request",
    );
  }

  async #json<T>(url: string, init: RequestInit, label: string): Promise<T> {
    return jsonRequest<T>(
      url,
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

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: {childCount?: number};
  file?: {mimeType?: string};
}

interface GraphPage {
  value?: GraphItem[];
  "@odata.nextLink"?: string;
}
