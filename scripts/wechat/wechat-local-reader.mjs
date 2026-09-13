import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import {desktopAccount, storeRegistryPath} from './wechat-account-registry.mjs';
import {withDesktopDatabase} from './wechat-desktop-store.mjs';
import {xmlElementText} from './wechat-message-history.mjs';
import {weChatTestChatAllowed} from './wechat-test-scope.mjs';

function text(value, compression) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!(value instanceof Uint8Array) || value.length > 4 * 1024 * 1024)
    throw new Error('Unsupported WeChat message encoding.');
  return Number(compression) === 4
    ? zstdDecompressSync(value, {maxOutputLength: 4 * 1024 * 1024}).toString('utf8')
    : Buffer.from(value).toString('utf8');
}

export function nativeMediaMetadata(kind, content) {
  const tag = ({image:'img',video:'videomsg',audio:'voicemsg',emoticon:'emoji'})[kind];
  const elements = tag ? [...content.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, 'gi'))] : [];
  const element = elements.length === 1 ? elements[0][1] : null;
  const attr = name => {
    const values = [...(element ?? '').matchAll(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'gi'))];
    return values.length === 1 ? values[0][2] : '';
  };
  const positive = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : undefined;
  if (kind === 'file') return {filename:xmlElementText(content,'title'), md5:xmlElementText(content,'md5'),
    length:positive(xmlElementText(content,'totallen'))};
  if (!element) return {};
  const digest = attr('md5');
  const durationSeconds = positive(attr('playlength'));
  const durationMs = durationSeconds == null ? undefined : durationSeconds * 1000;
  return {...(/^[a-f0-9]{32}$/i.test(digest) ? {md5:digest.toLowerCase()} : {}),
    ...(positive(attr('length') || attr('len')) ? {length:positive(attr('length') || attr('len'))} : {}),
    ...(kind === 'audio' && positive(attr('voicelength')) ? {durationMs:positive(attr('voicelength'))} : {}),
    ...(kind === 'video' && Number.isSafeInteger(durationMs) ? {durationMs} : {})};
}

export function nativeHistoryRows(db, chatId, {since = 0, until = Number.MAX_SAFE_INTEGER, limit = 200} = {}) {
  if (typeof chatId !== 'string' || !/^[A-Za-z0-9_@-]{1,128}$/.test(chatId) ||
      ![since, until, limit].every(Number.isSafeInteger) || since < 0 || until < since || limit < 1 || limit > 1000)
    throw new Error('Invalid WeChat history request.');
  const table = `Msg_${createHash('md5').update(chatId).digest('hex')}`;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return [];
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  for (const name of ['local_id', 'server_id', 'create_time', 'local_type', 'real_sender_id', 'message_content'])
    if (!columns.has(name)) throw new Error('This WeChat database format needs a Polymux update.');
  const optional = name => columns.has(name) ? name : 'NULL';
  const query = db.prepare(`SELECT CAST(local_id AS TEXT) AS local_id, CAST(server_id AS TEXT) AS server_id,
    create_time, local_type, message_content, ${optional('WCDB_CT_message_content')} AS content_compression,
    ${optional('source')} AS message_source, ${optional('WCDB_CT_source')} AS source_compression,
    (SELECT user_name FROM Name2Id WHERE rowid=real_sender_id) AS sender_wxid
    FROM ${table} WHERE create_time>=? AND create_time<=? ORDER BY create_time DESC, local_id DESC LIMIT ?`);
  query.setReadBigInts(true);
  return query.all(since, until, limit).map(row => {
    let content = text(row.message_content, row.content_compression);
    const prefix = `${row.sender_wxid}:\n`;
    if (chatId.endsWith('@chatroom') && row.sender_wxid && content.startsWith(prefix)) content = content.slice(prefix.length);
    const type = Number(BigInt(row.local_type) & 0xffffffffn);
    let kind = ({1:'text',3:'image',34:'audio',35:'audio',43:'video',47:'emoticon',48:'location',49:'appmsg',50:'call',10000:'system',10002:'recalled'})[type] ?? 'unknown';
    if (kind === 'appmsg' && xmlElementText(content, 'type') === '6') {
      kind = 'file';
    }
    const media = nativeMediaMetadata(kind, content);
    // Keep exact native sender and 64-bit identifiers. Unknown source metadata
    // remains absent so mentions cannot be falsely marked as verified.
    return {local_id: row.local_id, server_id: row.server_id, create_time: Number(row.create_time),
      sender_wxid: row.sender_wxid, message_kind: kind, message_content: content, display_text: content, media,
      ...(columns.has('source') ? {message_source: text(row.message_source, row.source_compression)} : {})};
  });
}

/** Read-only replacement for the account/contact/history CLI calls used by
 * the writer. No command dispatch, network access, or native mutation. */
export async function readLocalCommand(args, options = {}) {
  const selected = {...options, registryPath: options.registryPath ?? process.env.POLYMUX_WECHAT_STORE_REGISTRY ?? storeRegistryPath(options.home)};
  const account = await desktopAccount(selected);
  selected.accountWxid = account.wxid;
  const option = name => {const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1];};
  if (args[0] === 'accounts') return {accounts: [{wxid: account.wxid}]};
  if (args[0] === 'contacts') {
    const query = option('--query');
    if (typeof query !== 'string' || !query) throw new Error('A WeChat contact identity is required.');
    return withDesktopDatabase(selected, 'contact/contact.db', db => db.prepare(
      'SELECT username, nick_name, remark, alias FROM contact WHERE username=?').all(query)
      .map(row => ({...row, display_name: row.remark || row.nick_name || row.alias || row.username})));
  }
  if (args[0] !== 'history') throw new Error('This operation is unavailable in the local WeChat reader.');
  const chatId = args[1];
  if (!weChatTestChatAllowed(chatId)) throw new Error('WeChat history is outside the selected test chats.');
  const since = option('--since');
  const bounds = {since: since === '3 minutes ago' ? Math.floor(Date.now()/1000)-180 : Number(since ?? 0),
    until: Number(option('--until') ?? Number.MAX_SAFE_INTEGER), limit: Number(option('--limit') ?? 200)};
  const rows = [];
  for (const entry of Object.keys(account.keys).filter(name => /^message\/message_\d+\.db$/.test(name)))
    rows.push(...await withDesktopDatabase(selected, entry, db => nativeHistoryRows(db, chatId, bounds)));
  rows.sort((a,b) => b.create_time-a.create_time || (BigInt(b.local_id)>BigInt(a.local_id) ? 1 : -1));
  return {rows: rows.slice(0, bounds.limit)};
}
