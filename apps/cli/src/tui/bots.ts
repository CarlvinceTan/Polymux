import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import type {AcpRegistryEntryDto, BotAgentSettingsDto, BotDto, JsonValue, LaptopCapabilityLeaseDto, TeamHostDto, UpdateBotRequest} from '@polymux/protocol';
import {chooseProfile, confirm, type Choice, type WorkspaceUi} from './workspace-ui.js';
import {browseSchedules} from './schedules.js';

const states: Record<BotDto['status'], string> = {
  idle: 'Idle', working: 'Working', 'waiting-for-device': 'Needs device',
  'computer-offline': 'Computer offline', error: 'Error',
};

export function botChoice(bot: BotDto): Choice {
  return {value: bot.id, label: bot.name,
    description: [bot.role, bot.hostName].filter(Boolean).join(' · '),
    status: `${bot.unread ? '● ' : ''}${states[bot.status] ?? bot.status}`};
}

export function botSummary(bot: BotDto): string {
  return [bot.role, '', `Status: ${states[bot.status] ?? bot.status}`,
    `Computer: ${bot.computer.state}${bot.computer.detail ? ` · ${bot.computer.detail}` : ''}`,
    `Device: ${bot.hostName}`, `Profile: ${bot.profileName}`,
    ...(bot.setupError ? [`Setup: failed · ${bot.setupError}`] : bot.setupPending ? ['Setup: pending · first-run turn has not started yet'] : []),
    `Agent: ${bot.agentRuntime?.kind === 'acp' ? bot.agentRuntime.name : 'Polymux'}`,
    `Device access: ${bot.laptopAccess}`,
    ...Object.entries(bot.deviceAccess ?? {}).map(([id, mode]) => `  ${id}: ${mode}`),
    '', `Skills: ${bot.skills?.join(', ') || 'None'}`,
    `MCPs: ${bot.mcpServers?.join(', ') || 'None'}`,
    `Plugins: ${bot.plugins?.join(', ') || 'None'}`,
    '', bot.preview || 'No messages yet'].join('\n');
}

/** Midas-style browser -> actions -> details; every mutation stays bot-scoped. */
export async function browseBots(ui: WorkspaceUi): Promise<void> {
  for (;;) {
    const bots = await ui.client.call<BotDto[]>('team.list');
    const id = await ui.pick('Bots', [
      {value: '+', label: 'Create bot'}, {value: 'import', label: 'Import bot'},
      {value: 'refresh', label: 'Refresh'}, ...bots.map(botChoice),
    ]);
    if (!id) return;
    if (id === 'refresh') continue;
    if (id === '+') {await createBot(ui); continue;}
    if (id === 'import') {
      const file = await ui.prompt('Bot file to import');
      if (!file) continue;
      const transfer = JSON.parse(await readFile(file, 'utf8')) as JsonValue;
      const profile = await chooseProfile(ui);
      if (profile) await ui.client.call('team.import', [transfer, profile]);
      continue;
    }
    if (await botActions(ui, id)) return;
  }
}

async function createBot(ui: WorkspaceUi): Promise<void> {
  const name = await ui.prompt('Bot name');
  if (!name?.trim()) return;
  const role = await ui.prompt('Instructions');
  if (!role?.trim()) return;
  const profileId = await chooseProfile(ui);
  if (!profileId) return;
  await ui.client.call('team.create', [{name: name.trim(), role: role.trim(), profileId,
    avatar: {shape: 'circle', color: '#61afef'}}]);
}

async function botActions(ui: WorkspaceUi, id: string): Promise<boolean> {
  for (;;) {
    // Re-read after every action: status and permissions may have changed remotely.
    const bot = (await ui.client.call<BotDto[]>('team.list')).find(b => b.id === id);
    if (!bot) return false;
    const action = await ui.pick(`${bot.name} · ${states[bot.status] ?? bot.status}`, [
      {value: 'chat', label: 'Open conversation'},
      {value: 'summary', label: 'Summary'},
      {value: 'schedule', label: 'Schedules'},
      {value: 'edit', label: 'Settings'},
      {value: 'agent', label: 'Agent settings'},
      ...(bot.setupPending || bot.setupError
        ? [{value: 'retry-setup', label: 'Retry setup', description: bot.setupError ?? 'First-run turn has not started yet'}]
        : []),
      {value: 'computer', label: bot.computer.state === 'running' ? 'Stop computer' : 'Start computer', description: bot.computer.detail ?? bot.computer.state},
      {value: 'access', label: 'Device access'},
      {value: 'leases', label: 'Temporary access'},
      {value: 'read', label: 'Mark read'},
      {value: 'export', label: 'Export'},
      {value: 'remove', label: 'Delete bot'},
    ]);
    if (!action) return false;
    if (action === 'chat') {
      await ui.openChat({id: bot.conversationId, title: bot.name});
      await ui.client.call('team.markRead', [id]);
      return true;
    }
    if (action === 'summary') await ui.show(bot.name, botSummary(bot));
    if (action === 'schedule') await browseSchedules(ui, bot.id);
    if (action === 'retry-setup') {
      await ui.client.call('team.retrySetup', [id]);
      continue;
    }
    if (action === 'edit') await editBot(ui, bot);
    if (action === 'agent') await agentSettings(ui, bot);
    if (action === 'read') await ui.client.call('team.markRead', [id]);
    if (action === 'computer') await ui.client.call(bot.computer.state === 'running' ? 'team.stopComputer' : 'team.startComputer', [id]);
    if (action === 'access') {
      const hosts = await ui.client.call<TeamHostDto[]>('team.hosts');
      const device = await ui.pick('Device access', [{value: 'default', label: 'Default for all devices', description: bot.laptopAccess}, ...hosts.map(h => ({value: h.hostId, label: h.deviceName, description: bot.deviceAccess?.[h.hostId] ?? `Default (${bot.laptopAccess})`}))]);
      if (!device) continue;
      const mode = await ui.pick('Access policy', [
        ...(device !== 'default' ? [{value: 'default', label: 'Use default'}] : []),
        {value: 'allow', label: 'Allow'}, {value: 'ask', label: 'Ask each time'}, {value: 'off', label: 'Off'},
      ]);
      if (!mode) continue;
      if (device === 'default') await ui.client.call('team.update', [id, {laptopAccess: mode}]);
      else {
        const deviceAccess = {...bot.deviceAccess};
        if (mode === 'default') delete deviceAccess[device];
        else deviceAccess[device] = mode as 'allow' | 'ask' | 'off';
        await ui.client.call('team.update', [id, {deviceAccess}]);
      }
    }
    if (action === 'leases') {
      const leases = await ui.client.call<LaptopCapabilityLeaseDto[]>('team.leases', [id]);
      const lease = await ui.pick('Temporary access', [{value: '+', label: 'Grant temporary access'}, ...leases.map(l => ({value: l.id, label: l.capabilities.join(', '), description: `${l.hostId} · until ${l.expiresAt}`}))]);
      if (lease === '+') {
        const hosts = await ui.client.call<TeamHostDto[]>('team.hosts');
        const host = await ui.pick('Device', hosts.map(h => ({value: h.hostId, label: h.deviceName})));
        if (!host) continue;
        const capability = await ui.pick('Allow temporarily', ['browser', 'computer', 'files'].map(value => ({value, label: value[0].toUpperCase() + value.slice(1)})));
        if (!capability) continue;
        const duration = await ui.pick('Duration', [5, 15, 30, 60].map(n => ({value: String(n), label: `${n} minutes`})));
        if (duration && await confirm(ui, `Allow ${bot.name} ${capability} access on ${hosts.find(h => h.hostId === host)?.deviceName} for ${duration} minutes?`))
          await ui.client.call('team.grantLease', [id, [capability], Number(duration), host]);
      } else if (lease && await confirm(ui, 'Revoke temporary access?')) await ui.client.call('team.revokeLease', [lease]);
    }
    if (action === 'export') {
      const file = await ui.prompt('Export to file');
      if (file) {
        const value = await ui.client.call<JsonValue>('team.export', [id]);
        await writeFile(file, JSON.stringify(value, null, 2), {flag: 'wx', mode: 0o600});
        ui.notify('Bot exported');
      }
    }
    if (action === 'remove' && await confirm(ui, `Delete ${bot.name} and its conversation?`)) {
      await ui.client.call('team.remove', [id]);
      return false;
    }
  }
}

async function editBot(ui: WorkspaceUi, bot: BotDto): Promise<void> {
  const key = await ui.pick('Bot settings', [
    {value: 'name', label: 'Name', description: bot.name},
    {value: 'role', label: 'Instructions', description: bot.role},
    {value: 'profileId', label: 'Connections profile', description: bot.profileName},
    ...(['skills', 'mcpServers', 'plugins'] as const).map(value => ({value, label: value === 'mcpServers' ? 'MCPs' : value === 'skills' ? 'Skills' : 'Plugins', description: bot[value]?.join(', ') || 'None'})),
  ]);
  if (!key) return;
  const value = key === 'profileId' ? await chooseProfile(ui) : await ui.prompt(
    ['skills', 'mcpServers', 'plugins'].includes(key) ? `${key === 'mcpServers' ? 'MCP' : key} names, separated by commas (empty clears)` : key === 'role' ? 'Instructions' : 'Name');
  if (value === undefined) return;
  const patch: UpdateBotRequest = ['skills', 'mcpServers', 'plugins'].includes(key)
    ? {[key]: [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))]}
    : {[key]: value.trim()};
  await ui.client.call('team.update', [bot.id, patch as JsonValue]);
}

async function agentSettings(ui: WorkspaceUi, bot: BotDto): Promise<void> {
  const action = await ui.pick('Agent settings', [
    {value: 'choose', label: 'Choose agent'},
    {value: 'options', label: 'Models and options'},
    {value: 'login', label: 'Sign in'},
    {value: 'logout', label: 'Sign out'},
  ]);
  if (!action) return;
  if (action === 'choose') {
    const registry = await ui.client.call<AcpRegistryEntryDto[]>('team.agentRegistry');
    const selected = await ui.pick('Agent for this bot', [
      {value: 'polymux', label: 'Polymux'},
      ...registry.filter(a => a.command).map(a => ({value: a.id, label: a.name, description: a.description})),
    ]);
    if (!selected) return;
    const entry = registry.find(a => a.id === selected);
    const runtime = entry ? {kind: 'acp', name: entry.name, command: entry.command, args: entry.args,
      agentId: entry.id, configId: randomUUID(), registryEnvironment: entry.environment ?? {}}
      : {kind: 'polymux'};
    await ui.client.call('team.update', [bot.id, {agentRuntime: runtime} as JsonValue]);
    return;
  }
  if (bot.agentRuntime?.kind !== 'acp') {
    if (action === 'login' || action === 'logout') {
      await ui.show('Providers', 'Polymux uses the Host model providers. Open /providers to manage their sign-in. Models and thinking can be selected separately for this bot.');
      return;
    }
    const config = await ui.client.call<{model: string | null; reasoning: string}>('runs.configuration', [bot.conversationId]);
    const field = await ui.pick('Polymux settings', [{value: 'model', label: 'Model', description: config.model ?? 'Choose model'}, {value: 'reasoning', label: 'Thinking', description: config.reasoning}]);
    if (!field) return;
    const items = field === 'model'
      ? (await ui.client.call<Array<{provider: string; id: string; name: string}>>('models.list', [bot.conversationId])).map(m => ({value: `${m.provider}/${m.id}`, label: m.name, description: m.provider}))
      : ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => ({value, label: value}));
    const value = await ui.pick(field === 'model' ? 'Model for this bot' : 'Thinking for this bot', items);
    if (value) await ui.client.call('runs.configure', [bot.conversationId, {[field]: value}]);
    return;
  }
  const {settings} = await ui.client.call<BotAgentSettingsDto>('team.agentSettings', [bot.id, {action: 'get'}]);
  if (action === 'logout') {
    if (!settings.supportsLogout) {ui.notify('This agent does not support sign out'); return;}
    if (await confirm(ui, 'Sign out this bot?')) await ui.client.call('team.agentSettings', [bot.id, {action: 'logout'}]);
  } else if (action === 'login') {
    const id = await ui.pick('Sign in', settings.authMethods.filter(m => m.available).map(m => ({value: m.id, label: m.name, description: m.description ?? undefined})));
    if (id) await ui.client.call('team.agentSettings', [bot.id, {action: 'authenticate', methodId: id}]);
  } else {
    const id = await ui.pick('Models and options', settings.configOptions.map(o => ({value: o.id, label: o.name, description: String(o.currentValue)})));
    const option = settings.configOptions.find(o => o.id === id);
    if (!option) return;
    const choices = option.type === 'boolean' ? [{value: 'true', label: 'On'}, {value: 'false', label: 'Off'}]
      : [...option.options, ...option.groups.flatMap(g => g.options)].map(o => ({value: o.value, label: o.name}));
    const value = await ui.pick(option.name, choices);
    if (value !== undefined) await ui.client.call('team.agentSettings', [bot.id, {action: 'option', id: option.id, value: option.type === 'boolean' ? value === 'true' : value}]);
  }
}
