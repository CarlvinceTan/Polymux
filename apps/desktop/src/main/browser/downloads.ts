import crypto from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { BrowserDownloadDto } from "@polymux/protocol";
import type { DownloadItem, Session } from "electron";

/**
 * What the embedded browser does with a file a page hands it.
 *
 * Downloads used to be a plain array that emptied on quit, and every file was
 * written straight over whatever already had its name. Now the history is in
 * the database, the destination is the user's to choose, and a name already
 * taken is stepped past rather than through.
 */

export interface DownloadRecords {
  startDownload(input: {
    id: string;
    url: string;
    filename: string;
    path: string;
    mimeType?: string | null;
    totalBytes?: number;
    state?: BrowserDownloadDto["state"];
  }): unknown;
  updateDownload(
    id: string,
    patch: {
      state?: BrowserDownloadDto["state"];
      receivedBytes?: number;
      totalBytes?: number;
      path?: string;
    },
  ): unknown;
  listDownloads(options?: { limit?: number }): {
    id: string;
    url: string;
    filename: string;
    path: string;
    receivedBytes: number;
    totalBytes: number;
    state: BrowserDownloadDto["state"];
    startedAt: string;
    finishedAt: string | null;
  }[];
  deleteDownload(id: string): boolean;
  clearDownloads(): number;
}

export interface DownloadPreferences {
  directory: string;
  askWhereToSave: boolean;
}

/** Opening a file and revealing it are injected rather than imported, so this
 * module holds no runtime dependency on Electron and can be tested directly. */
export interface DownloadShell {
  openPath(target: string): void;
  showItemInFolder(target: string): void;
}

/**
 * A path that is not already taken. Chromium's own "(1)" suffixing lives
 * behind its save dialog and is not reachable from `setSavePath`, so setting a
 * path by hand means doing this by hand too — otherwise the second copy of a
 * file silently destroys the first.
 */
export function availablePath(directory: string, filename: string): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  for (let index = 1; existsSync(candidate); index += 1)
    candidate = path.join(directory, `${stem} (${index})${extension}`);
  return candidate;
}

export function downloadKind(file: string): BrowserDownloadDto["kind"] {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic"].includes(extension))
    return "image";
  if ([".csv", ".xlsx", ".xls", ".numbers", ".tsv"].includes(extension)) return "spreadsheet";
  if ([".doc", ".docx", ".txt", ".md", ".rtf", ".pages"].includes(extension)) return "document";
  return "file";
}

export class Downloads {
  readonly #records: DownloadRecords;
  readonly #preferences: () => DownloadPreferences;
  readonly #send: (downloads: BrowserDownloadDto[]) => void;
  readonly #shell: DownloadShell;
  /** Live Electron items, by the id their row carries. Only downloads still
   * running are in here; a finished one is history and nothing more. */
  readonly #active = new Map<string, DownloadItem>();
  #wired = false;

  constructor(options: {
    records: DownloadRecords;
    preferences: () => DownloadPreferences;
    send: (downloads: BrowserDownloadDto[]) => void;
    shell: DownloadShell;
  }) {
    this.#records = options.records;
    this.#preferences = options.preferences;
    this.#send = options.send;
    this.#shell = options.shell;
  }

  /** Session-wide capture, wired once. Every browser tab shares one session,
   * so a second call would double-handle every download. */
  wire(session: Session): void {
    if (this.#wired) return;
    this.#wired = true;
    session.on("will-download", (_event, item) => this.#accept(item));
  }

  list(): BrowserDownloadDto[] {
    return this.#records.listDownloads().map((row) => ({
      id: row.id,
      title: row.filename,
      path: row.path,
      kind: downloadKind(row.filename),
      completedAt: new Date(row.finishedAt ?? row.startedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      url: row.url,
      state: row.state,
      receivedBytes: row.receivedBytes,
      totalBytes: row.totalBytes,
    }));
  }

  pause(id: string): BrowserDownloadDto[] {
    const item = this.#active.get(id);
    if (!item) return this.list();
    if (!item.isPaused()) item.pause();
    this.#records.updateDownload(id, { state: "paused" });
    return this.list();
  }

  resume(id: string): BrowserDownloadDto[] {
    const item = this.#active.get(id);
    if (!item) return this.list();
    // A server without range support cannot resume; Electron restarts the
    // transfer instead, which is still the right answer to "resume".
    if (item.isPaused()) item.resume();
    this.#records.updateDownload(id, { state: "progressing" });
    return this.list();
  }

  cancel(id: string): BrowserDownloadDto[] {
    this.#active.get(id)?.cancel();
    this.#records.updateDownload(id, { state: "cancelled" });
    return this.list();
  }

  /** Forgets an entry. The file stays where it is — this is the history, and
   * deleting the user's file is not what removing a row from it means. */
  remove(id: string): BrowserDownloadDto[] {
    this.#active.get(id)?.cancel();
    this.#active.delete(id);
    this.#records.deleteDownload(id);
    return this.list();
  }

  clear(): BrowserDownloadDto[] {
    for (const item of this.#active.values()) item.cancel();
    this.#active.clear();
    this.#records.clearDownloads();
    return this.list();
  }

  open(id: string): void {
    const entry = this.#records.listDownloads().find((row) => row.id === id);
    if (entry?.state === "completed") this.#shell.openPath(entry.path);
  }

  openFolder(): void {
    const latest = this.#records
      .listDownloads()
      .find((row) => row.state === "completed" && existsSync(row.path));
    if (latest) this.#shell.showItemInFolder(latest.path);
    else this.#shell.openPath(this.directory());
  }

  /** The download directory, created if it has gone missing since it was
   * chosen — a path the user picked months ago may not still be there. */
  directory(): string {
    const directory = this.#preferences().directory;
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  /**
   * Files the app wrote itself — a screenshot, say — so they appear in the
   * same history as anything the user downloaded.
   */
  record(file: string, url: string): BrowserDownloadDto {
    const id = crypto.randomUUID();
    this.#records.startDownload({
      id,
      url,
      filename: path.basename(file),
      path: file,
      totalBytes: 0,
      state: "completed",
    });
    const downloads = this.list();
    this.#send(downloads);
    return downloads.find((entry) => entry.id === id)!;
  }

  #accept(item: DownloadItem): void {
    const id = crypto.randomUUID();
    const directory = this.directory();
    const { askWhereToSave } = this.#preferences();
    const target = availablePath(directory, item.getFilename());
    if (askWhereToSave) {
      // Leaving the save path unset is what makes Chromium show its dialog;
      // these options only decide what that dialog opens on.
      item.setSaveDialogOptions({ defaultPath: target });
    } else {
      item.setSavePath(target);
    }
    this.#records.startDownload({
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      // With a dialog in play the real path is not known until it closes, so
      // the row starts on the proposed one and is corrected on first progress.
      path: target,
      mimeType: item.getMimeType() || null,
      totalBytes: item.getTotalBytes(),
    });
    this.#active.set(id, item);
    this.#send(this.list());

    item.on("updated", (_event, state) => {
      this.#records.updateDownload(id, {
        state: item.isPaused() ? "paused" : state === "interrupted" ? "interrupted" : "progressing",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || target,
      });
      this.#send(this.list());
    });
    item.once("done", (_event, state) => {
      this.#active.delete(id);
      this.#records.updateDownload(id, {
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || target,
      });
      this.#send(this.list());
    });
  }
}
