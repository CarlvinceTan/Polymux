# @polymux/storage

Durable local storage for Polymux. The package contains storage contracts and a SQLite implementation; it has no Electron, renderer, inference, or agent-loop dependencies.

```ts
import { SqliteStorage } from "@polymux/storage";

const storage = new SqliteStorage("/path/to/polymux.sqlite");
storage.createConversation({ id: crypto.randomUUID(), title: "New chat" });
```

SQLite stores conversations, messages, replayable run events, compaction summaries, preferences, and file metadata. Its legacy memory table is retained only for one-time migration and compatibility; active durable memory is managed by the agent package as a local Markdown vault. Attachment and artifact contents belong in an app-managed directory and only their paths and metadata belong in the database.

Schema changes are forward migrations controlled by `PRAGMA user_version`. Foreign keys, scope constraints, run/conversation guards, transactions, WAL mode, and a busy timeout are enabled by the implementation.
