import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import type {DriveEntryDto} from "@flareai/protocol";
import {
  contentRange,
  SIMPLE_UPLOAD_LIMIT,
  uploadInChunks,
} from "./chunks.js";
import {downloadToFile} from "./download.js";
import {jsonRequest, request} from "./http.js";
import {OAuthClient, oauthAppFromEnv} from "./oauth.js";
import {
  copyName,
  type DriveAdapter,
  type DriveConsentPrompt,
  type DriveProbe,
  type DriveSecretStore,
} from "./types.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
// `webUrl` is Graph's own page for the item, which is where "open where it
// lives" goes for a file that has no path on this Mac.
const ITEM_FIELDS = "id,name,size,lastModifiedDateTime,folder,file,webUrl";

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

  constructor(
    secrets: DriveSecretStore,
    consent: DriveConsentPrompt,
    accountId?: string,
  ) {
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

  async describe(target: string): Promise<DriveEntryDto> {
    return this.#entry(
      await this.#get<GraphItem>(
        `/me/drive/items/${target}?$select=${ITEM_FIELDS}`,
      ),
    );
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
    const parent = await this.#item(parentPath);
    const size = (await stat(localPath)).size;
    if (size > SIMPLE_UPLOAD_LIMIT)
      return this.#uploadSession(localPath, parent, name);

    const bytes = await readFile(localPath);
    const response = await request(
      `${GRAPH}/me/drive/items/${parent}:/${encodeURIComponent(
        name,
      )}:/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${await this.#oauth.accessToken()}`,
          "content-type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
      },
      "The upload",
    );
    return this.#entry((await response.json()) as GraphItem);
  }

  /**
   * A Graph upload session.
   *
   * Each accepted chunk comes back as 202 with `nextExpectedRanges`, which is
   * the server's own account of what it holds — followed rather than assumed,
   * so a chunk sent twice after a timeout resumes instead of duplicating. The
   * session url is pre-authorised, so those requests carry no bearer token.
   */
  async #uploadSession(
    localPath: string,
    parent: string,
    name: string,
  ): Promise<DriveEntryDto> {
    const opened = await this.#json<{uploadUrl?: string}>(
      `${GRAPH}/me/drive/items/${parent}:/${encodeURIComponent(
        name,
      )}:/createUploadSession`,
      {
        method: "POST",
        body: JSON.stringify({
          item: {"@microsoft.graph.conflictBehavior": "rename"},
        }),
      },
      "Starting the upload",
    );
    if (!opened.uploadUrl)
      throw new Error("OneDrive did not open an upload.");

    const uploadUrl = opened.uploadUrl;
    return uploadInChunks(localPath, async (chunk) => {
      const response = await request(
        uploadUrl,
        {
          method: "PUT",
          headers: {
            "content-length": String(chunk.end - chunk.start),
            "content-range": contentRange(chunk),
          },
          body: new Uint8Array(chunk.bytes),
        },
        "The upload",
      );
      const body = (await response.json().catch(() => ({}))) as GraphItem & {
        nextExpectedRanges?: string[];
      };
      if (body.id) return {done: this.#entry(body)};
      return {resumeAt: expectedOffset(body.nextExpectedRanges) ?? chunk.end};
    });
  }

  async download(target: string, destination: string): Promise<void> {
    // Graph offers several hashes and which one depends on the account type.
    // SHA-256 is checkable here; quickXorHash, which business accounts return
    // instead, is a Microsoft-specific algorithm and is left unverified rather
    // than reimplemented.
    const item = await this.#get<
      GraphItem & {file?: {hashes?: {sha256Hash?: string}}}
    >(`/me/drive/items/${target}?$select=size,file`);
    const expected = item.file?.hashes?.sha256Hash;
    await downloadToFile(destination, {
      expect: {
        size: item.size ?? null,
        hash: expected ? {algorithm: "sha256", expected} : null,
      },
      open: async (offset) =>
        request(
          `${GRAPH}/me/drive/items/${target}/content`,
          {
            headers: {
              authorization: `Bearer ${await this.#oauth.accessToken()}`,
              ...(offset > 0 ? {range: `bytes=${offset}-`} : {}),
            },
          },
          "The download",
        ),
    });
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
    const response = await request(
      `${GRAPH}/me/drive/items/${target}/copy`,
      {
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
      },
      "Duplicating the file",
    );
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
      webUrl: item.webUrl ?? null,
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

/** `bytes=7864320-` means the server holds everything before that offset. */
function expectedOffset(ranges: string[] | undefined): number | null {
  const start = ranges?.[0]?.match(/^(\d+)-/)?.[1];
  return start === undefined ? null : Number(start);
}

interface GraphItem {
  /** The item's page in OneDrive, requested in ITEM_FIELDS. */
  webUrl?: string;
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
