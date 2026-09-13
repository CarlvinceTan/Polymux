import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {test} from "node:test";
import {migrate} from "../src/sqlite/migrations.js";
import {bloubColorForTheme} from "../../../apps/desktop/src/renderer/lib/features/team/bloub/colors.js";

test("upgrades existing monochrome bots once without changing other avatar choices or conversation data", () => {
  const database = new DatabaseSync(":memory:");
  try {
    migrate(database);
    database.exec("PRAGMA user_version = 8");
    const insert = database.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?)");
    const pair = {light: "#123456", dark: "#abcdef"};
    const records = [
      {teamMember: {version: 1, name: "Bob", avatar: {shape: "circle", color: "#f1efe9"}}, other: "preserved"},
      {teamMember: {version: 1, name: "Ink", avatar: {shape: "triangle", color: "#0A0A0C"}}},
      {teamMember: {version: 1, name: "Violet", avatar: {shape: "circle", color: "#8b5cf6"}}},
      {teamMember: {version: 1, name: "Custom pair", avatar: {shape: "circle", color: "#f1efe9", colorPair: pair}}},
      {unrelated: {avatar: {shape: "circle", color: "#f1efe9"}}},
    ];
    records.forEach((record, i) => insert.run(String(i), "Original title", "created", "updated", null, JSON.stringify(record)));
    const read = () => database.prepare("SELECT * FROM conversations ORDER BY id").all();
    const before = read();
    migrate(database);
    const after = read();
    after.forEach((row, i) => {
      assert.deepEqual({...row, metadata_json: before[i]!.metadata_json}, {...before[i]});
      const metadata = JSON.parse(String(row.metadata_json));
      if (i < 2) {
        const avatar = metadata.bot.avatar;
        assert.equal(bloubColorForTheme(avatar, "light"), "#0a0a0c");
        assert.equal(bloubColorForTheme(avatar, "dark"), "#f1efe9");
        const {teamMember, ...rest} = records[i]!;
        assert.deepEqual(metadata, {...rest, bot: {
          ...records[i]!.teamMember,
          avatar: {...records[i]!.teamMember!.avatar, color: "#0a0a0c", colorPair: {light: "#0a0a0c", dark: "#f1efe9"}},
        }});
      } else if (i < 4) {
        const {teamMember, ...rest} = records[i]!;
        assert.deepEqual(metadata, {...rest, bot: teamMember});
      } else assert.deepEqual(row, before[i]);
    });
    insert.run("later", "Fixed custom cream", "created", "updated", null, JSON.stringify(records[0]));
    const migrated = read();
    migrate(database);
    assert.deepEqual(read(), migrated);
  } finally {
    database.close();
  }
});
