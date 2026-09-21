import path from 'node:path';
import {loadDeviceSecret, TeamHostClient} from '@polymux/host';
import type {TeamHostDto} from '@polymux/protocol';

export async function tuiHost(local: TeamHostClient, root: string, selector?: string): Promise<{client: TeamHostClient; name?: string; hostId?: string}> {
  if (!selector || selector === 'local') return {client: local};
  const hosts = await local.call<TeamHostDto[]>('team.hosts');
  const exact = hosts.find(h => h.hostId === selector);
  const matches = exact ? [exact] : hosts.filter(h => h.deviceName.toLocaleLowerCase() === selector.toLocaleLowerCase());
  if (matches.length !== 1) throw new Error(matches.length ? 'More than one device has that name. Use its Host id.' : 'That Host is not paired. Connect it in /devices first.');
  const host = matches[0];
  if (host.mode === 'local') return {client: local};
  if (!host.endpoint) throw new Error('That Host has no connection endpoint.');
  const endpoint = new URL(host.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('A secure Host endpoint is required.');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Host endpoint.');
  const secret = await loadDeviceSecret(path.join(root, 'host', 'devices'), local.secret, host.hostId);
  return {client: new TeamHostClient(host.endpoint, secret), name: host.deviceName, hostId: host.hostId};
}
