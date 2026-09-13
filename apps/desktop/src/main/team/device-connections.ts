import {randomBytes} from 'node:crypto';
import {hostname} from 'node:os';
import {HOST_PAIRING_CODE_LENGTH, deviceType, hostRelayCodePairEndpoint, isHostPairingCode, normalizeHostPairingCode, type DevicePairingRequest, type DevicePairingState} from '@polymux/protocol';
import type {TeamHostServer} from './host-server.js';
import type {TeamService} from './service.js';

interface Outgoing {
  id: string; token: string; number: string; expiresAt: string; deviceName: string;
  endpoint: string; hostId: string; reverseSecret: string;
}
export class DeviceConnections {
  #outgoing: Outgoing | null = null;
  #starting = false;
  #poll: Promise<boolean> | null = null;
  #error = '';
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly server: TeamHostServer, readonly team: TeamService, readonly relayOrigin = 'https://connect.polymux.com', readonly onConnected: () => void | Promise<void> = () => {}) {}

  close(): void { clearTimeout(this.#timer); this.#outgoing = null; }
  private schedulePoll(): void {
    clearTimeout(this.#timer);
    if (!this.#outgoing) return;
    this.#timer = setTimeout(() => {
      void this.request({action: 'state'}).then(state => { if (state.connected) return this.onConnected(); }).catch(() => {}).finally(() => this.schedulePoll());
    }, 1000);
    this.#timer.unref?.();
  }

  async request(request: DevicePairingRequest): Promise<DevicePairingState> {
    let connected = false;
    if (request.action === 'start') await this.start(request);
    if (request.action === 'approve') await this.server.approvePairing(request.id, request.number);
    if (request.action === 'cancel') await this.cancel();
    if (request.action === 'revoke') this.server.revokePeer(request.deviceId);
    if (request.action === 'state') {
      this.#poll ??= this.poll().finally(() => this.#poll = null);
      connected = await this.#poll;
    }
    const snapshot = this.server.snapshot();
    const {id, number, expiresAt, deviceName} = this.#outgoing ?? {id: '', number: '', expiresAt: '', deviceName: ''};
    const result: DevicePairingState = {approvals: snapshot.approvals, connectedDevices: snapshot.connectedDevices, outgoing: id ? {id, number, expiresAt, deviceName} : null, error: this.#error || undefined, connected};
    if (request.action === 'execution') result.executionDeviceId = this.team.executionDevice(request.conversationId);
    if (request.action === 'invitation') {
      if (!snapshot.endpoint?.startsWith('https://')) throw new Error('Connect this device to Polymux Connect first.');
      const invitation = this.server.pairing.invitation();
      const token = Buffer.from(JSON.stringify({endpoint: snapshot.endpoint, invitation: invitation.token})).toString('base64url');
      result.installCommand = `curl -fsSL https://polymux.com/install.sh | sh -s -- connect ${token}`;
    }
    return result;
  }

  private async start(request: Extract<DevicePairingRequest, {action: 'start'}>): Promise<void> {
    if (this.#starting || this.#outgoing) throw new Error('Finish or cancel the current connection first.');
    this.#starting = true; this.#error = '';
    try {
      const code = normalizeHostPairingCode(request.code ?? '');
      if (!request.invitation && !isHostPairingCode(code)) throw new Error(`Enter the ${HOST_PAIRING_CODE_LENGTH}-character code.`);
      const local = this.team.localHost();
      const endpoint = request.endpoint ? secureEndpoint(request.endpoint) : null;
      if (endpoint && endpoint === local.listeningEndpoint) throw new Error('Enter the code from your other device.');
      const reverseSecret = randomBytes(32).toString('base64url');
      const response = await fetch(endpoint ? `${endpoint}/polymux-host/v1/pair` : hostRelayCodePairEndpoint(this.relayOrigin), {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({code, invitation: request.invitation, desktopId: local.desktopId, deviceName: hostname(), deviceType: local.deviceType, peer: local.listeningEndpoint ? {endpoint: local.listeningEndpoint, hostId: local.hostId, secret: reverseSecret} : undefined}),
        signal: AbortSignal.timeout(12_000),
      });
      const value = await response.json() as Record<string, string>;
      if (response.status !== 202) throw new Error(value.error ?? 'The other device must support connection approval.');
      if (!value.id || !value.token || !value.number || !value.hostId || !value.expiresAt || !value.endpoint) throw new Error('Incomplete device confirmation.');
      if (value.hostId === local.hostId) throw new Error('You cannot connect a device to itself.');
      this.#outgoing = {id: value.id, token: value.token, number: value.number, expiresAt: value.expiresAt, hostId: value.hostId, deviceName: value.deviceName || 'Other device', endpoint: secureEndpoint(value.endpoint), reverseSecret};
      this.schedulePoll();
    } finally { this.#starting = false; }
  }

  private async poll(): Promise<boolean> {
    const pending = this.#outgoing;
    if (!pending) return false;
    if (Date.parse(pending.expiresAt) <= Date.now()) { this.#outgoing = null; this.#error = 'Connection expired. Try again.'; return false; }
    try {
      const result = await this.exchange(pending, 'status');
      if (this.#outgoing !== pending) return false;
      if (result.status === 'rejected') { this.#outgoing = null; this.#error = 'The connection was declined or the number did not match.'; }
      if (result.status !== 'approved') return false;
      const credentials = result.credentials as Record<string, unknown>;
      if (credentials?.hostId !== pending.hostId || typeof credentials?.secret !== 'string') throw new Error('Device identity changed during confirmation.');
      await this.team.savePeerConnection(pending.endpoint, credentials);
      if (this.#outgoing !== pending) return false;
      this.server.authorizePeer(pending.hostId, pending.deviceName, pending.reverseSecret, deviceType(credentials.deviceType));
      await this.exchange(pending, 'ack').catch(() => {});
      this.#outgoing = null; this.#error = '';
      return true;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private async exchange(pending: Outgoing, action: 'status' | 'cancel' | 'ack'): Promise<Record<string, unknown>> {
    const response = await fetch(`${pending.endpoint}/polymux-host/v1/pair/${action}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: pending.id, token: pending.token}), signal: AbortSignal.timeout(8000),
    });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Pairing failed.');
    return value;
  }
  private async cancel(): Promise<void> {
    const pending = this.#outgoing; this.#outgoing = null; this.#error = '';
    if (pending) {
      this.server.revokePeer(pending.hostId, pending.reverseSecret);
      await this.exchange(pending, 'cancel').catch(() => {});
    }
  }
}
function secureEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('A secure device endpoint is required.');
  return url.toString().replace(/\/$/, '');
}
