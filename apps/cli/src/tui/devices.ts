import {isHostPairingCode, normalizeHostPairingCode, parseTeamHostSetupCode, type DevicePairingRequest, type DevicePairingState} from '@polymux/protocol';
import {parseDeviceInvitation} from '../device-invitation.js';
import {confirm, type WorkspaceUi} from './workspace-ui.js';

export type DeviceRequest = (request: DevicePairingRequest) => Promise<DevicePairingState>;

export async function browseDevices(ui: WorkspaceUi, request: DeviceRequest): Promise<void> {
  for (;;) {
    const state = await request({action: 'state'});
    const selected = await ui.pick('Devices', [
      {value: '+', label: 'Connect device'}, {value: 'invitation', label: 'Create invitation'},
      {value: 'refresh', label: 'Refresh', description: state.error},
      ...(state.outgoing ? [{value: 'outgoing', label: 'Pending connection', description: state.outgoing.deviceName}] : []),
      ...state.approvals.map(a => ({value: `approval:${a.id}`, label: a.deviceName, status: 'Needs approval'})),
      ...state.connectedDevices.map(d => ({value: d.deviceId, label: d.deviceName, description: d.deviceType, status: d.online === false ? 'Offline' : 'Connected'})),
    ]);
    if (!selected) return;
    if (selected === '+') {
      const invitation = await ui.prompt('Invitation or pairing code');
      if (invitation?.trim()) {
        const raw = invitation.trim();
        const setup = parseTeamHostSetupCode(raw);
        const code = normalizeHostPairingCode(raw);
        const token = raw.match(/^curl -fsSL https:\/\/polymux\.com\/install\.sh \| sh -s -- connect ([A-Za-z0-9_-]+)$/)?.[1] ?? raw;
        const target = setup ?? (isHostPairingCode(code) ? {code} : parseDeviceInvitation(token));
        const result = await request({action: 'start', ...target});
        if (result.outgoing) await ui.show('Confirm on the other device', `${result.outgoing.deviceName}\n\nChoose ${result.outgoing.number} on that device.\nExpires ${result.outgoing.expiresAt}`);
        if (result.error) ui.notify(result.error);
      }
    } else if (selected === 'invitation') {
      const result = await request({action: 'invitation'});
      await ui.show('Device invitation', result.installCommand ?? result.error ?? 'Connect this Host to Polymux Connect first.');
    } else if (selected === 'outgoing' && state.outgoing) {
      await ui.show('Pending connection', `${state.outgoing.deviceName}\n\nChoose ${state.outgoing.number} on the other device.\nExpires ${state.outgoing.expiresAt}`);
      if (await confirm(ui, 'Cancel this pending connection?')) await request({action: 'cancel'});
    } else if (selected.startsWith('approval:')) {
      const approval = state.approvals.find(a => `approval:${a.id}` === selected)!;
      const number = await ui.pick(`Number shown on ${approval.deviceName}`, [{value: 'decline', label: 'Decline'}, ...approval.choices.map(value => ({value, label: value}))]);
      if (number) await request({action: 'approve', id: approval.id, number: number === 'decline' ? null : number});
    } else {
      const device = state.connectedDevices.find(d => d.deviceId === selected);
      if (!device) continue;
      await ui.show(device.deviceName, `${device.deviceType ?? 'Device'}\n${device.online === false ? 'Offline' : 'Connected'}\nPaired ${device.pairedAt}`);
      if (await confirm(ui, `Disconnect ${device.deviceName}?`)) await request({action: 'revoke', deviceId: device.deviceId});
    }
  }
}
