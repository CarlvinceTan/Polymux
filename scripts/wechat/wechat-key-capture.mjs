/** Private staging for the opt-in CommonCrypto key observer. This module never
 * launches, attaches to, re-signs or modifies WeChat. Its caller must establish
 * the guarded launch and account before supplying the returned environment.
 */
import {constants} from 'node:fs';
import {chmod, mkdtemp, open, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {isKeyForDatabase} from './wechat-key-auth.mjs';

const MAX_PAGES = 128, PAGE_SIZE = 4096, RECORD_SIZE = 36;
const MAGIC = Buffer.from('PMXKEY01');
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function pageFrom(file) {
  const handle = await open(file, constants.O_RDONLY | NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('WeChat database is not a regular file');
    const page = Buffer.alloc(PAGE_SIZE);
    if ((await handle.read(page, 0, page.length, 0)).bytesRead !== PAGE_SIZE)
      throw new Error('WeChat database has no complete encrypted first page');
    if (page.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')))
      throw new Error('WeChat database is not encrypted');
    return page;
  } finally { await handle.close(); }
}

/** One bounded setup attempt. The caller owns authorization and the guarded
 * process callbacks. Never retry a login request or silently import old keys.
 */
export async function captureWeChatDatabaseKeys({dbDir, entries, launch, sessionState, requestLogin,
  temporaryRoot, budgetMs = 55_000, pollMs = 250}) {
  if (![launch, sessionState, requestLogin].every(value => typeof value === 'function') ||
      !Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 55_000 ||
      !Number.isFinite(pollMs) || pollMs < 1)
    throw new Error('Invalid WeChat key capture request');
  const capture = await prepareWeChatKeyCapture({dbDir, entries, temporaryRoot});
  const deadline = performance.now() + budgetMs;
  let result = {keys: new Map(), missing: [...entries]}, state = 'launching', attemptedLogin = false;
  const clear = () => { for (const key of result.keys.values()) key.fill(0); };
  try {
    const launched = await launch(capture.directory);
    if (launched?.ok !== true || launched?.guarded !== true || launched?.alreadyRunning !== false ||
        !Number.isSafeInteger(launched.pid) || launched.pid <= 1 ||
        !Number.isSafeInteger(launched.birthSeconds) || launched.birthSeconds <= 0 ||
        !Number.isSafeInteger(launched.birthMicros) || launched.birthMicros < 0 || launched.birthMicros >= 1_000_000)
      throw new Error('WeChat key capture did not establish a new guarded process');
    while (performance.now() < deadline) {
      const next = await capture.read(); clear(); result = next;
      if (!result.missing.length) return {...result, state: 'captured', pid: launched.pid};
      const status = await sessionState(launched.pid, launched);
      state = status?.state ?? 'unavailable';
      if (status?.pid !== undefined && status.pid !== launched.pid)
        throw new Error('WeChat process changed during key capture');
      if (status?.ok !== true) { state = 'unavailable'; break; }
      if (['locked', 'signed_out'].includes(state)) break;
      // Qt can temporarily remove every accessibility control while replacing
      // its login window. That is a pending observation on the same process,
      // not a reason to discard the observer before database opening finishes.
      // Missing identity or an unfamiliar state cannot authorize a login.
      if (status.pid !== launched.pid ||
          !['launching', 'unavailable', 'remembered_login', 'interactive_login', 'signed_in'].includes(state)) {
        state = 'unavailable'; break;
      }
      if (state === 'remembered_login' && !attemptedLogin) {
        attemptedLogin = true;
        const login = await requestLogin(launched.pid, launched);
        if (login?.pid !== undefined && login.pid !== launched.pid)
          throw new Error('WeChat process changed during login');
        if (login?.ok !== true || login?.primed !== true || login.pid !== launched.pid) {
          // A dispatched login may still finish after the primer's chat-list
          // check. Keep collecting and polling read-only, never re-dispatch.
          // Only this known intermediate failure with an exact target and an
          // explicit dispatch receipt is eligible; guard/identity refusals and
          // malformed responses still end the attempt.
          if (login?.pid !== launched.pid || login.loginSubmissionAttempted !== true ||
              login.reason !== 'wechat_chat_list_unavailable') {
            state = login?.reason ?? 'login_unconfirmed'; break;
          }
        }
      }
      await delay(Math.min(pollMs, Math.max(0, deadline - performance.now())));
    }
    const next = await capture.read(); clear(); result = next;
    return {...result, state, pid: launched.pid};
  } catch (error) { clear(); throw error; }
  finally { await capture.dispose(); }
}

/** The caller selects an exact account root and relative database entries.
 * At least one existing encrypted page is required; first-ever Desktop login
 * before any database exists needs a separate discovery phase.
 */
export async function prepareWeChatKeyCapture({dbDir, entries, temporaryRoot = tmpdir()}) {
  if (!path.isAbsolute(dbDir) || !Array.isArray(entries) || !entries.length || entries.length > MAX_PAGES ||
      new Set(entries).size !== entries.length || entries.some(entry => typeof entry !== 'string' ||
        !entry.endsWith('.db') || entry.includes('\0') || path.isAbsolute(entry) ||
        entry.split(/[\\/]/).some(part => !part || part === '.' || part === '..')))
    throw new Error('Invalid WeChat capture database selection');
  const root = await realpath(dbDir);
  const selected = await Promise.all(entries.map(async entry => {
    const file = await realpath(path.join(root, entry));
    if (!file.startsWith(root + path.sep)) throw new Error('WeChat capture database escaped its selected account');
    return {entry, file, page: await pageFrom(file)};
  }));
  const directory = await mkdtemp(path.join(temporaryRoot, 'polymux-wechat-key-capture-'));
  let disposed = false;
  const dispose = async () => { disposed = true; await rm(directory, {recursive: true, force: true}); };
  try {
    await chmod(directory, 0o700);
    const header = Buffer.alloc(12);
    MAGIC.copy(header); header.writeUInt32LE(selected.length, 8);
    await writeFile(path.join(directory, 'pages'), Buffer.concat([header, ...selected.map(row => row.page)]), {mode: 0o600, flag: 'wx'});
    await writeFile(path.join(directory, 'keys'), Buffer.alloc(0), {mode: 0o600, flag: 'wx'});
  } catch (error) { await dispose(); throw error; }

  return {
    directory,
    environment: {POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY: directory},
    dispose,
    /** Keys stay private to the caller. Recheck every captured key against the
     * exact current encrypted source before allowing registry publication.
     * Missing keys are partial capture, never inferred or filled from legacy.
     */
    async read() {
      if (disposed) throw new Error('WeChat key capture has been closed');
      if (await realpath(dbDir) !== root) throw new Error('WeChat capture account directory changed');
      const handle = await open(path.join(directory, 'keys'), constants.O_RDONLY | NOFOLLOW | constants.O_NONBLOCK);
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 ||
            stat.size > selected.length * RECORD_SIZE || stat.size % RECORD_SIZE)
          throw new Error('Invalid or incomplete private WeChat key capture');
        bytes = Buffer.alloc(stat.size);
        if ((await handle.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length)
          throw new Error('WeChat key capture changed during reading');
      } finally { await handle.close(); }
      const keys = new Map();
      try {
        for (let offset = 0; offset < bytes.length; offset += RECORD_SIZE) {
          const index = bytes.readUInt32LE(offset), row = selected[index];
          if (!row || keys.has(row.entry)) throw new Error('Invalid WeChat key capture database record');
          if (await realpath(path.join(root, row.entry)) !== row.file)
            throw new Error('WeChat capture database identity changed');
          const key = bytes.subarray(offset + 4, offset + RECORD_SIZE);
          if (!isKeyForDatabase(row.page, key) || !isKeyForDatabase(await pageFrom(row.file), key))
            throw new Error('Captured WeChat key no longer authenticates its database');
          keys.set(row.entry, Buffer.from(key));
        }
        return {keys, missing: selected.filter(row => !keys.has(row.entry)).map(row => row.entry)};
      } catch (error) {
        for (const key of keys.values()) key.fill(0);
        throw error;
      } finally { bytes.fill(0); }
    },
  };
}
