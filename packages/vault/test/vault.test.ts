import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeMasterPassword,
  createDatabase,
  fieldText,
  importCsvLogins,
  importKdbxFile,
  listItems,
  listTrash,
  loadDatabase,
  OTP_FIELD,
  PASSKEY_RP,
  purgeItem,
  readSecrets,
  RECOVERY_FIELD,
  removeItem,
  reorderItems,
  restoreItem,
  saveDatabase,
  setPinned,
  totpFor,
  upsertItem,
  WRONG_PASSWORD,
} from "../src/index.js";

test("a vault round-trips passwords, TOTP, recovery codes and passkeys", async () => {
  const db = await createDatabase("correct horse battery");
  const id = upsertItem(db, {
    title: "GitHub",
    username: "ada",
    password: "s3cret",
    url: "https://github.com",
    notes: "work",
    totpSecret: "JBSWY3DPEHPK3PXP",
    recoveryCodes: ["AAAA-1111", "BBBB-2222"],
    passkey: {
      relyingParty: "github.com",
      username: "ada@example.com",
      credentialId: "cred-1",
      userHandle: "handle",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    },
  });

  const bytes = await saveDatabase(db);
  const reopened = await loadDatabase(Uint8Array.from(bytes).buffer, "correct horse battery");
  const item = listItems(reopened).find((row) => row.id === id);
  assert.ok(item);
  assert.equal(item.title, "GitHub");
  assert.equal(item.username, "ada");
  assert.equal(item.hasPassword, true);
  assert.equal(item.hasTotp, true);
  assert.equal(item.hasRecoveryCodes, true);
  assert.equal(item.hasPasskey, true);
  assert.equal(item.notes, "work");

  const secrets = readSecrets(reopened, id);
  assert.equal(secrets.password, "s3cret");
  assert.equal(secrets.recoveryCodes.join(","), "AAAA-1111,BBBB-2222");
  assert.equal(secrets.passkey?.relyingParty, "github.com");
  assert.match(secrets.passkey?.privateKeyPem ?? "", /PRIVATE KEY/);
  const totp = totpFor(reopened, id, 59_000);
  assert.equal(totp?.code.length, 6);
  assert.equal(totp?.next.length, 6);
  assert.notEqual(totp?.next, totp?.code);
  assert.equal(fieldText(find(reopened, id), OTP_FIELD).startsWith("otpauth://totp/"), true);
  assert.equal(fieldText(find(reopened, id), RECOVERY_FIELD).includes("AAAA-1111"), true);
  assert.equal(fieldText(find(reopened, id), PASSKEY_RP), "github.com");
});

test("a wrong master password fails without echoing the secret", async () => {
  const db = await createDatabase("right-password");
  upsertItem(db, { title: "X", password: "hidden" });
  const bytes = await saveDatabase(db);
  await assert.rejects(
    () => loadDatabase(copy(bytes), "wrong-password"),
    (reason: unknown) => {
      assert.ok(reason instanceof Error);
      assert.equal(reason.message, WRONG_PASSWORD);
      assert.equal(reason.message.includes("wrong-password"), false);
      assert.equal(reason.message.includes("right-password"), false);
      assert.equal(reason.message.includes("hidden"), false);
      return true;
    },
  );
});

test("KeePass import copies entries into a folder", async () => {
  const source = await createDatabase("source-key");
  upsertItem(source, {title: "Mail", username: "ada", password: "pw", url: "https://mail.example"});
  const bytes = await saveDatabase(source);
  const target = await createDatabase("target-key");
  const result = await importKdbxFile(
    target,
    copy(bytes),
    "source-key",
    "Imported",
  );
  assert.equal(result.imported, 1);
  const item = listItems(target).find((row) => row.title === "Mail");
  assert.ok(item);
  assert.equal(readSecrets(target, item.id).password, "pw");
  assert.equal(item.groupName, "Imported");
});

test("Chrome CSV import lands as KeePass entries", async () => {
  const db = await createDatabase("import-key");
  const result = importCsvLogins(
    db,
    "name,url,username,password,note\nMail,https://mail.example,ada,pw,note\n",
  );
  assert.equal(result.imported, 1);
  const item = listItems(db)[0];
  assert.equal(item?.title, "Mail");
  assert.equal(readSecrets(db, item!.id).password, "pw");
});

test("removing an entry keeps it in trash until restored or purged", async () => {
  const db = await createDatabase("delete-key");
  const id = upsertItem(db, { title: "Temp", password: "x" });
  assert.equal(removeItem(db, id), true);
  assert.equal(listItems(db).length, 0);
  assert.equal(listTrash(db).length, 1);
  assert.equal(listTrash(db)[0]?.title, "Temp");
  assert.equal(restoreItem(db, id), true);
  assert.equal(listItems(db).length, 1);
  assert.equal(listTrash(db).length, 0);
  assert.equal(removeItem(db, id), true);
  assert.equal(purgeItem(db, id), true);
  assert.equal(listTrash(db).length, 0);
});

test("pinned items sort first and a custom order is kept", async () => {
  const db = await createDatabase("order-key");
  const zebra = upsertItem(db, { title: "Zebra", password: "z" });
  const alpha = upsertItem(db, { title: "Alpha", password: "a" });
  const beta = upsertItem(db, { title: "Beta", password: "b" });
  assert.deepEqual(listItems(db).map((item) => item.title), ["Alpha", "Beta", "Zebra"]);
  setPinned(db, [zebra], true);
  assert.equal(listItems(db)[0]?.id, zebra);
  assert.equal(listItems(db)[0]?.pinned, true);
  reorderItems(db, [beta, alpha, zebra]);
  assert.deepEqual(listItems(db).map((item) => item.id), [zebra, beta, alpha]);
});

test("changing the master password reopens with the new one", async () => {
  const db = await createDatabase("old-password");
  upsertItem(db, { title: "X", password: "hidden" });
  await changeMasterPassword(db, "new-password-ok");
  const bytes = await saveDatabase(db);
  const reopened = await loadDatabase(copy(bytes), "new-password-ok");
  assert.equal(listItems(reopened)[0]?.title, "X");
  await assert.rejects(() => loadDatabase(copy(bytes), "old-password"));
});

function copy(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function find(db: Awaited<ReturnType<typeof createDatabase>>, id: string) {
  for (const group of db.getDefaultGroup().allGroups()) {
    for (const entry of group.entries) {
      if (entry.uuid.toString() === id) return entry;
    }
  }
  throw new Error("missing");
}
