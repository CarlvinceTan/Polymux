import type {PolymuxAccountClient} from '@polymux/locker';
import {hostRelayPublicEndpoint} from '@polymux/protocol';

export interface AccountHost {
  user_id: string;
  device_id: string;
  device_name: string;
  host_id: string;
  pairing_secret: string;
  public_endpoint: string;
  last_heartbeat: string;
}

/** Only send account pairing secrets to the canonical relay endpoint for that host. */
export function availableAccountHosts(rows: unknown, userId: string, now = Date.now()): AccountHost[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is AccountHost => {
    if (!row || row.user_id !== userId || typeof row.host_id !== 'string' || !/^[\w-]+$/.test(row.host_id)) return false;
    if (typeof row.device_id !== 'string' || typeof row.device_name !== 'string' || typeof row.pairing_secret !== 'string' || !/^[\w-]{43}$/.test(row.pairing_secret)) return false;
    const age = now - Date.parse(row.last_heartbeat);
    return Number.isFinite(age) && age >= -30_000 && age <= 45_000
      && row.public_endpoint === hostRelayPublicEndpoint('https://connect.polymux.com', row.host_id);
  });
}

export async function discoverAccountHosts(client: PolymuxAccountClient): Promise<AccountHost[]> {
  const userId = client.userId();
  if (!userId) return [];
  const response = await client.authorizedFetch(client.restUrl('/rest/v1/devices', {
    user_id: `eq.${userId}`, select: 'user_id,device_id,device_name,host_id,pairing_secret,public_endpoint,last_heartbeat',
  }));
  if (!response.ok) throw new Error('Your devices could not be loaded. Try again.');
  return availableAccountHosts(await response.json(), userId);
}
