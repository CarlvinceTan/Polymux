import {invoke} from '@tauri-apps/api/core';
import type {JsonValue, LockerListDto, LockerSecretsDto} from '@polymux/protocol';
import {isApplePhone} from './account';

const ENABLED = 'polymux-autofill-enabled';
export function autoFillEnabled() { return isApplePhone() && localStorage.getItem(ENABLED) === 'true'; }
export async function disableAutoFill() {
  if (!isApplePhone()) return;
  await invoke('plugin:polymux-apple|disableAutoFill');
  localStorage.removeItem(ENABLED);
}
export async function updateAutoFill(call: (method: string, args?: JsonValue[]) => Promise<unknown>) {
  if (!isApplePhone()) throw new Error('System AutoFill requires the iOS app.');
  const list = await call('locker.list') as LockerListDto;
  const entries = [];
  for (const item of list.items) {
    if (!item.hasPassword && !item.hasTotp) continue;
    const secrets = await call('locker.reveal', [item.id]) as LockerSecretsDto;
    const otpAuth = item.hasTotp ? await call('locker.otpauth', [item.id]) as string : null;
    entries.push({id: item.id, title: item.title, username: item.username, url: item.url, password: secrets.password, otpAuth});
  }
  try {
    await invoke('plugin:polymux-apple|updateAutoFill', {entries});
    localStorage.setItem(ENABLED, 'true');
  } finally { entries.length = 0; }
}
