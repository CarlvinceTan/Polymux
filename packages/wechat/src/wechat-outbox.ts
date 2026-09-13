import {DatabaseSync} from "node:sqlite";
import {chmodSync, mkdirSync} from "node:fs";
import path from "node:path";

export interface WeChatOutboxEntry {
  eventId: string;
  owner: string;
  chatId: string;
  status: "pending" | "unconfirmed" | "confirmed" | "failed";
  error: string | null;
  timestamp: number;
  body: string | null;
  previousIds: string[] | null;
  messageId: string | null;
  clientMessageId: string | null;
}

/** A send fence in Polymux's own storage, separate from its disposable import
 * cache. Committing an attempt precedes any native action. Recovery never
 * replays an attempt, including one interrupted before submission. */
export class WeChatOutbox {
  readonly #db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
    const file = path.join(directory, "outbox.sqlite");
    this.#db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      this.#db.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS attempts (
          event_id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'unconfirmed', 'confirmed', 'failed')),
          error TEXT,
          timestamp INTEGER NOT NULL,
          body TEXT,
          previous_ids TEXT,
          message_id TEXT,
          client_message_id TEXT
        );
      `);
    } catch (error) {this.#db.close(); throw error;}
  }

  get(eventId: string): WeChatOutboxEntry | null {
    const row = this.#db.prepare("SELECT * FROM attempts WHERE event_id = ?").get(eventId);
    return row ? decode(row) : null;
  }

  /** Atomic even if another bridge instance encounters the same event. */
  claim(eventId: string, owner: string, chatId: string): WeChatOutboxEntry | null {
    const result = this.#db.prepare(`INSERT INTO attempts
      (event_id, owner, chat_id, status, timestamp) VALUES (?, ?, ?, 'pending', ?)
      ON CONFLICT(event_id) DO NOTHING`).run(eventId, owner, chatId, Date.now());
    if (result.changes) return null;
    const previous = this.get(eventId)!;
    if (previous.owner !== owner || previous.chatId !== chatId)
      throw new Error("The WeChat send record belongs to a different destination");
    return previous;
  }

  textCandidate(eventId: string, body: string, timestamp: number, previousIds: string[]): void {
    this.#db.prepare(`UPDATE attempts SET body = ?, timestamp = ?, previous_ids = ?
      WHERE event_id = ? AND status = 'pending'`).run(body, timestamp, JSON.stringify(previousIds), eventId);
  }

  finish(eventId: string, status: "unconfirmed" | "confirmed" | "failed", error: string | null = null): void {
    // An exact native acknowledgement wins over a delayed timeout/rejection.
    this.#db.prepare(`UPDATE attempts SET status = ?, error = ?,
      body = CASE WHEN ? IN ('confirmed', 'failed') THEN NULL ELSE body END,
      previous_ids = CASE WHEN ? IN ('confirmed', 'failed') THEN NULL ELSE previous_ids END
      WHERE event_id = ? AND status != 'confirmed'`).run(status, error, status, status, eventId);
  }

  acknowledge(eventId: string, messageId: string, clientMessageId?: string): void {
    this.#db.prepare(`UPDATE attempts SET status = 'confirmed', error = NULL,
      message_id = ?, client_message_id = ?, body = NULL, previous_ids = NULL
      WHERE event_id = ?`).run(messageId, clientMessageId ?? null, eventId);
  }

  recover(owner: string): WeChatOutboxEntry[] {
    this.#db.prepare("UPDATE attempts SET status = 'unconfirmed' WHERE owner = ? AND status = 'pending'").run(owner);
    return this.#db.prepare("SELECT * FROM attempts WHERE owner = ? AND status != 'failed'")
      .all(owner).map(decode);
  }

  close(): void {this.#db.close();}
}

function decode(row: Record<string, unknown>): WeChatOutboxEntry {
  return {
    eventId: String(row.event_id), owner: String(row.owner), chatId: String(row.chat_id),
    status: row.status as WeChatOutboxEntry["status"],
    error: row.error as string | null, timestamp: Number(row.timestamp),
    body: row.body as string | null,
    previousIds: row.previous_ids === null ? null : JSON.parse(String(row.previous_ids)) as string[],
    messageId: row.message_id as string | null, clientMessageId: row.client_message_id as string | null,
  };
}
