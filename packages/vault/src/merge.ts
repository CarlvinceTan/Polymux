import kdbxweb from "kdbxweb";

/** Result of merging one decrypted vault into another. */
export interface VaultMergeResult {
  added: number;
  updated: number;
}

/**
 * Merge `source` into `target` in place, latest write wins per entry.
 *
 * Entries are matched by UUID across visible items and the recycle bin, so
 * two devices that diverged offline converge: entries missing on one side
 * are copied over (trash state preserved), and entries changed on both
 * sides keep the copy with the newer modification time. Purged (fully
 * deleted) entries cannot be distinguished from never-created ones, so a
 * purge on one side resurrects when the other side still has the entry.
 */
export function mergeKdbx(
  target: kdbxweb.Kdbx,
  source: kdbxweb.Kdbx,
): VaultMergeResult {
  const result: VaultMergeResult = {added: 0, updated: 0};
  for (const {entry, trashed} of allEntries(source)) {
    const id = entry.uuid.toString();
    const local = findAnywhere(target, id);
    if (!local) {
      copyEntry(target, source, entry, trashed);
      result.added += 1;
      continue;
    }
    if (local.trashed === trashed && sameTime(local.entry, entry)) continue;
    if (newerThan(entry, local.entry)) {
      target.move(local.entry, undefined);
      copyEntry(target, source, entry, trashed);
      result.updated += 1;
    } else if (local.trashed !== trashed && !newerThan(local.entry, entry)) {
      // Same-age delete-vs-restore tie: a restore wins so a delete on one
      // device does not silently drop an entry the other side just touched.
      if (!trashed) restoreEntry(target, local.entry);
    }
  }
  return result;
}

interface Located {
  entry: kdbxweb.KdbxEntry;
  group: kdbxweb.KdbxGroup;
  trashed: boolean;
}

function allEntries(db: kdbxweb.Kdbx): Located[] {
  const found: Located[] = [];
  for (const group of db.getDefaultGroup().allGroups()) {
    const trashed = underTrash(db, group);
    for (const entry of group.entries) found.push({entry, group, trashed});
  }
  return found;
}

function findAnywhere(db: kdbxweb.Kdbx, id: string): Located | null {
  for (const located of allEntries(db)) {
    if (located.entry.uuid.toString() === id || located.entry.uuid.id === id)
      return located;
  }
  return null;
}

function underTrash(db: kdbxweb.Kdbx, group: kdbxweb.KdbxGroup): boolean {
  const bin = db.meta.recycleBinUuid;
  if (!bin) return false;
  let current: kdbxweb.KdbxGroup | undefined = group;
  while (current) {
    if (current.uuid.equals(bin)) return true;
    current = current.parentGroup;
  }
  return false;
}

function restoreEntry(db: kdbxweb.Kdbx, entry: kdbxweb.KdbxEntry): void {
  const previous = entry.previousParentGroup
    ? db.getGroup(entry.previousParentGroup)
    : undefined;
  db.move(entry, previous && !underTrash(db, previous) ? previous : db.getDefaultGroup());
  entry.times.update();
}

function copyEntry(
  target: kdbxweb.Kdbx,
  source: kdbxweb.Kdbx,
  entry: kdbxweb.KdbxEntry,
  trashed: boolean,
): void {
  const sourceGroup = entry.parentGroup;
  const root = target.getDefaultGroup();
  let destination = root;
  if (sourceGroup && !sourceGroup.uuid.equals(source.getDefaultGroup().uuid)) {
    const name = sourceGroup.name?.trim() || "Group";
    destination =
      [...root.allGroups()].find((group) => group.name === name && !underTrash(target, group)) ??
      target.createGroup(root, name);
  }
  // importEntry assigns a fresh random UUID; restore the source one so the
  // same item stays identical on every device that merges it.
  const imported = target.importEntry(entry, destination, source);
  imported.uuid = new kdbxweb.KdbxUuid(entry.uuid.toString());
  if (trashed) target.remove(imported);
}

function timeOf(entry: kdbxweb.KdbxEntry): number {
  return entry.times.lastModTime?.getTime() ?? 0;
}

function sameTime(a: kdbxweb.KdbxEntry, b: kdbxweb.KdbxEntry): boolean {
  return timeOf(a) === timeOf(b);
}

function newerThan(a: kdbxweb.KdbxEntry, b: kdbxweb.KdbxEntry): boolean {
  return timeOf(a) > timeOf(b);
}
