import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export function storeRegistryPath(home = homedir()) {
  return process.platform === 'darwin'
    ? path.join(home, 'Library/Application Support/Polymux/wechat/store.json')
    : path.join(home, '.polymux/wechat/store.json');
}

/** Account selection never falls back to a different container or an external
 * tool when the selected registry is missing, ambiguous or malformed. */
export async function desktopAccount(options = {}) {
  const file = options.registryPath ?? process.env.POLYMUX_WECHAT_STORE_REGISTRY ?? storeRegistryPath(options.home);
  let registry;
  try { registry = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('WeChat database access is not set up in Polymux.'); }
  if (!registry?.accounts || typeof registry.accounts !== 'object' || Array.isArray(registry.accounts))
    throw new Error('The Polymux WeChat account registry is invalid.');
  const accounts = Object.entries(registry.accounts).map(([id, record]) => {
    if (!/^wxid_[A-Za-z0-9_-]+$/.test(id) || typeof record?.dbDir !== 'string' || !path.isAbsolute(record.dbDir) ||
        path.basename(record.dbDir) !== 'db_storage' || !record.keys || typeof record.keys !== 'object' || Array.isArray(record.keys))
      throw new Error('The Polymux WeChat account registry is invalid.');
    const folder = path.basename(path.dirname(record.dbDir));
    if (folder !== id && !new RegExp(`^${id}_[a-f0-9]{4}$`, 'i').test(folder))
      throw new Error('WeChat native database belongs to a different account.');
    const wxid = folder === id ? id.replace(/^(wxid_[A-Za-z0-9]+)_[a-f0-9]{4}$/i, '$1') : id;
    for (const [entry, key] of Object.entries(record.keys)) {
      if (!/^[\w-]+\/[\w-]+\.db$/.test(entry) || typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key))
        throw new Error('The Polymux WeChat database keys are invalid.');
    }
    return {wxid, dbDir: record.dbDir, keys: record.keys};
  });
  if (accounts.length !== 1) throw new Error('Polymux needs exactly one configured WeChat account.');
  const account = accounts[0];
  if (options.accountWxid && options.accountWxid !== account.wxid)
    throw new Error('WeChat native database belongs to a different account.');
  return account;
}
