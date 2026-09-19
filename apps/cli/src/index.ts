#!/usr/bin/env node
import {registerBunOAuthFlows} from "@earendil-works/pi-ai/bun-oauth";
import {randomBytes, randomUUID} from "node:crypto";
import {existsSync, realpathSync} from "node:fs";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline/promises";
import {stdin, stdout} from "node:process";
import {
  HeadlessHostRuntime,
  TeamHostClient,
  type TeamHostServerSnapshot,
} from "@polymux/host";
import {
  formatTeamHostSetupCode,
  isHostPairingCode,
  normalizeHostPairingCode,
  parseTeamHostSetupCode,
  type BotDto,
  type ConversationDto,
  type GoalDto,
  type JsonValue,
  type LaptopCapabilityLeaseDto,
  type MessageDto,
  type ProfileDto,
  type RunEventDto,
} from "@polymux/protocol";
import {terminalQr} from "./terminal-qr.js";
import {promptSecret, secretFromStdin} from "./secrets.js";
import {runTui} from './tui/index.js';
import {ensureTuiHost, localHostReady} from "./tui/host-startup.js";
import {hostPaths} from './paths.js';
import {authCommand} from './auth.js';

// Include lazy OAuth flows in the standalone Node bundle as well.
registerBunOAuthFlows();

declare const __POLYMUX_CLI_SUPABASE_URL__: string;
declare const __POLYMUX_CLI_SUPABASE_ANON_KEY__: string;

const VERSION = "0.3.0";
const args = process.argv.slice(2);


async function main(argv: string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (!command && stdin.isTTY && stdout.isTTY) { await interactiveChat(); return; }
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === 'auth') {
    await authCommand(subcommand ?? 'status', parseFlags(rest), accountRequest);
    return;
  }
  if (command === 'connect') {
    await connectCommand([subcommand, ...rest].filter((value): value is string => Boolean(value))); return;
  }
  if (command === 'devices') {
    await devicesCommand(subcommand ?? "state", rest); return;
  }
  if (command === "host") {
    await hostCommand(subcommand ?? "status", rest);
    return;
  }
  if (command === "team") {
    await teamCommand(subcommand ?? "list", rest);
    return;
  }
  if (command === "conversations") {
    await conversationsCommand(subcommand ?? "list", rest);
    return;
  }
  if (command === "goals") {
    await goalsCommand(subcommand ?? "get", rest);
    return;
  }
  if (command === "runs") {
    await runsCommand(subcommand ?? "active", rest);
    return;
  }
  if (command === "hub") {
    await hubCommand(subcommand ?? "chats", rest);
    return;
  }
  if (command === "locker") {
    await lockerCommand(subcommand ?? "status", rest);
    return;
  }
  if (command === "call") {
    await callMethod(subcommand, rest.join(" "));
    return;
  }
  if (command === "run") {
    await runOnce(subcommand, rest);
    return;
  }
  if (command === "chat") {
    if (stdin.isTTY && stdout.isTTY) await interactiveChat(subcommand);
    else await chat(subcommand);
    return;
  }
  if (command === 'tui') {
    if (!stdin.isTTY || !stdout.isTTY) throw new Error('The TUI needs an interactive terminal. Use polymux run for scripts.');
    await interactiveChat(subcommand);
    return;
  }
  throw new Error(`Unknown command “${[command, subcommand].filter(Boolean).join(" ")}”. Run polymux help.`);
}

async function hostCommand(command: string, rest: string[]): Promise<void> {
  switch (command) {
    case "serve": await serveHost(rest); return;
    case "install": await installService(parseFlags(rest).start !== false); return;
    case "uninstall": await uninstallService(); return;
    case "start": await controlService("start"); return;
    case "stop": await controlService("stop"); return;
    case "restart": await controlService("restart"); return;
    case "status": await hostStatus(parseFlags(rest).json === true); return;
    case "pair": await showPairing(); return;
    default: throw new Error(`Unknown Host command “${command}”. Run polymux help.`);
  }
}

async function serveHost(argv: string[] = []): Promise<void> {
  const flags = parseFlags(argv);
  const paths = hostPaths();
  await mkdir(paths.data, {recursive: true, mode: 0o700});
  await loadEnvironmentFile(path.join(paths.config, "host.env"));
  const adminSecret = await loadOrCreateSecret(paths.adminSecret);
  const {listen, publicEndpoint, relayEndpoint} = hostNetworkOptions(flags);
  const port = hostPort(flagString(flags, "port") ?? process.env.POLYMUX_HOST_PORT);
  const model = flagString(flags, "model") || process.env.POLYMUX_MODEL || undefined;
  const runtime = new HeadlessHostRuntime({
    dataDirectory: paths.data,
    configDirectory: paths.config,
    listen,
    port,
    publicEndpoint: publicEndpoint || null,
    relayEndpoint,
    adminSecret,
    model,
    appVersion: VERSION,
    account: {
      url: process.env.POLYMUX_SUPABASE_URL?.trim() || (typeof __POLYMUX_CLI_SUPABASE_URL__ === 'string' ? __POLYMUX_CLI_SUPABASE_URL__ : '') || null,
      anonKey: process.env.POLYMUX_SUPABASE_ANON_KEY?.trim() || (typeof __POLYMUX_CLI_SUPABASE_ANON_KEY__ === 'string' ? __POLYMUX_CLI_SUPABASE_ANON_KEY__ : '') || null,
    },
    beginPairing: flags["pairing"] === false ? false : undefined,
  });
  const snapshot = await runtime.start();
  if (snapshot.state !== "listening" || !snapshot.endpoint)
    throw new Error(snapshot.detail ?? "Host did not start");
  await writeState(paths.state, snapshot);
  printSnapshot(snapshot);
  const finish = async () => {
    await rm(paths.state, {force: true});
    await runtime.close();
  };
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void finish().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function hostStatus(json = false): Promise<void> {
  const state = await readState();
  const response = await fetch(`${state.localEndpoint ?? state.endpoint}/polymux-host/v1/health`, {
    signal: AbortSignal.timeout(3_000),
  }).catch((): null => null);
  if (!response?.ok) throw new Error("Host is not responding");
  const health = await response.json() as {
    deviceName?: string; paired?: boolean; hostId?: string; deviceType?: string; capabilities?: string[];
  };
  if (json) {
    stdout.write(JSON.stringify({
      endpoint: state.endpoint,
      localEndpoint: state.localEndpoint,
      deviceName: health.deviceName ?? "Polymux Host",
      paired: Boolean(health.paired),
      hostId: health.hostId ?? null,
      deviceType: health.deviceType ?? null,
      capabilities: health.capabilities ?? [],
    }, null, 2) + "\n");
    return;
  }
  stdout.write([
    `Host: ${health.deviceName ?? "Polymux Host"}`,
    `Status: running`,
    `Endpoint: ${state.endpoint}`,
    `Desktop: ${health.paired ? "paired" : "not paired"}`,
  ].join("\n") + "\n");
}

async function showPairing(): Promise<void> {
  const client = await adminClient();
  const snapshot = await client.beginPairing();
  await writeState(hostPaths().state, snapshot);
  printSnapshot(snapshot);
  if (stdin.isTTY && stdout.isTTY) {
    const reader = createInterface({input: stdin, output: stdout});
    try {
      while (Date.now() < Date.parse(snapshot.pairingExpiresAt ?? '')) {
        const state = await deviceRequest({action: 'state'});
        const approval = state.approvals[0];
        if (approval) {
          const answer = await reader.question(`Connect ${approval.deviceName}? Enter the number shown on that device (${approval.choices.join(', ')}), or press Enter to decline: `);
          await deviceRequest({action: 'approve', id: approval.id, number: answer.trim() || null});
          stdout.write('Confirmation submitted.\n'); return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      stdout.write('Pairing expired. Run polymux host pair to try again.\n');
    } finally { reader.close(); }
  }
}

async function deviceRequest(value: import('@polymux/protocol').DevicePairingRequest): Promise<import('@polymux/protocol').DevicePairingState> {
  const client = await adminClient();
  const response = await fetch(`${client.endpoint}/polymux-host/v1/admin/devices/request`, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${client.secret}`}, body: JSON.stringify(value), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as import('@polymux/protocol').DevicePairingState & {error?: string};
  if (!response.ok) throw new Error(result.error ?? 'Device connection failed.');
  return result;
}

async function devicesCommand(subcommand: string, rest: string[]): Promise<void> {
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "state": {
      const state = await deviceRequest({action: 'state'});
      if (flags.json) stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      else stdout.write(`${devicesStateText(state)}\n`);
      return;
    }
    case "invitation": {
      const state = await deviceRequest({action: 'invitation'});
      if (!state.installCommand) throw new Error('Connect this device to Polymux Connect first.');
      stdout.write(`${state.installCommand}\n`);
      return;
    }
    case "list": {
      const state = await deviceRequest({action: 'state'});
      if (flags.json) {
        stdout.write(`${JSON.stringify(state.connectedDevices, null, 2)}\n`);
        return;
      }
      if (!state.connectedDevices.length) {
        stdout.write("No devices connected.\n");
        return;
      }
      for (const device of state.connectedDevices)
        stdout.write(`${device.deviceId}\t${device.deviceName}\t${device.deviceType ?? "device"}\t${device.online === false ? "offline" : "online"}\n`);
      return;
    }
    case "approve": {
      const [id, number] = flags.positional;
      if (!id) throw new Error('Usage: polymux devices approve REQUEST_ID NUMBER');
      await deviceRequest({action: 'approve', id, number: number ?? null});
      stdout.write("Confirmation submitted.\n");
      return;
    }
    case "revoke": {
      const [deviceId] = flags.positional;
      if (!deviceId) throw new Error('Usage: polymux devices revoke DEVICE_ID');
      await deviceRequest({action: 'revoke', deviceId});
      stdout.write("Device access revoked.\n");
      return;
    }
    case "execution": {
      const [conversationId] = flags.positional;
      if (!conversationId) throw new Error('Usage: polymux devices execution CONVERSATION_ID');
      const state = await deviceRequest({action: 'execution', conversationId});
      stdout.write(`${state.executionDeviceId ?? "unknown"}\n`);
      return;
    }
    case "cancel": {
      await deviceRequest({action: 'cancel'});
      stdout.write("Pending connection cancelled.\n");
      return;
    }
    default: throw new Error(`Unknown devices command “${subcommand}”. Run polymux help.`);
  }
}

function devicesStateText(state: import('@polymux/protocol').DevicePairingState): string {
  const lines: string[] = [];
  if (state.outgoing)
    lines.push(`Outgoing: ${state.outgoing.number} for ${state.outgoing.deviceName} (expires ${state.outgoing.expiresAt})`);
  else lines.push("Outgoing: none");
  if (!state.approvals.length) lines.push("Approvals: none");
  for (const approval of state.approvals)
    lines.push(`Approval: ${approval.id} ${approval.deviceName} choices ${approval.choices.join(", ")} (expires ${approval.expiresAt})`);
  if (!state.connectedDevices.length) lines.push("Devices: none");
  for (const device of state.connectedDevices)
    lines.push(`Device: ${device.deviceName} (${device.deviceId})${device.online === false ? " offline" : ""}`);
  if (state.error) lines.push(`Error: ${state.error}`);
  lines.push(`Connected: ${state.connected ? "yes" : "no"}`);
  return lines.join("\n");
}

export function parseDeviceInvitation(encoded: string): {endpoint: string; invitation: string} {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(encoded)) throw new Error('Invalid installation invitation.');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const endpoint = new URL(value.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^[A-Za-z0-9_-]{43}$/.test(value.invitation)) throw new Error('Invalid installation invitation.');
  return {endpoint: endpoint.toString().replace(/\/$/, ''), invitation: value.invitation};
}

async function connectCommand(argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const codeFlag = flagString(flags, "code");
  const endpointFlag = flagString(flags, "endpoint");
  const [positional] = flags.positional;
  if (codeFlag || endpointFlag) {
    const code = normalizeHostPairingCode(codeFlag ?? positional ?? "");
    if (!isHostPairingCode(code)) throw new Error('Enter the 9-character connect code.');
    await connectWithCode(code, endpointFlag ?? null);
    return;
  }
  if (!positional) throw new Error('Paste the complete installation command from Devices.');
  const setup = parseTeamHostSetupCode(positional);
  if (setup) {
    await connectWithCode(setup.code, setup.endpoint);
    return;
  }
  await connectInvitation(positional);
}

async function connectInvitation(encoded: string): Promise<void> {
  const invitation = parseDeviceInvitation(encoded);
  try { await deviceRequest({action: 'state'}); }
  catch { await installService(true, false); }
  let state = await deviceRequest({action: 'start', ...invitation});
  stdout.write(`Select ${state.outgoing?.number} on ${state.outgoing?.deviceName} to approve this connection.\n`);
  const deadline = Date.parse(state.outgoing?.expiresAt ?? '') || Date.now();
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    state = await deviceRequest({action: 'state'});
    if (state.connected) { stdout.write('Devices connected. Choose this device in your Assistant or bot settings.\n'); return; }
    if (state.error) throw new Error(state.error);
  }
  await deviceRequest({action: 'cancel'});
  throw new Error('Connection expired. Copy a new installation command from Devices.');
}

async function connectWithCode(code: string, endpoint: string | null): Promise<void> {
  try { await deviceRequest({action: 'state'}); }
  catch { await installService(true, false); }
  let state = await deviceRequest(endpoint ? {action: 'start', code, endpoint} : {action: 'start', code});
  stdout.write(`Select ${state.outgoing?.number} on ${state.outgoing?.deviceName} to approve this connection.\n`);
  const deadline = Date.parse(state.outgoing?.expiresAt ?? '') || Date.now();
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    state = await deviceRequest({action: 'state'});
    if (state.connected) { stdout.write('Devices connected. Choose this device in your Assistant or bot settings.\n'); return; }
    if (state.error) throw new Error(state.error);
  }
  await deviceRequest({action: 'cancel'});
  throw new Error('Connection expired. Enter a fresh connect code from your other device.');
}

async function teamCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "list": {
      const members = await client.call<BotDto[]>("team.list");
      if (flags.json) {
        stdout.write(`${JSON.stringify(members, null, 2)}\n`);
        return;
      }
      listTeam(members);
      return;
    }
    case "profiles": {
      const profiles = await client.call<ProfileDto[]>("team.profiles");
      if (flags.json) {
        stdout.write(`${JSON.stringify(profiles, null, 2)}\n`);
        return;
      }
      if (!profiles.length) {
        stdout.write("No profiles on this Host.\n");
        return;
      }
      for (const profile of profiles)
        stdout.write(`${profile.id}\t${profile.name}${profile.teamEligible === false ? "\t(not team eligible)" : ""}\n`);
      return;
    }
    case "create": {
      const [name] = flags.positional;
      const role = flagString(flags, "role");
      const profileId = flagString(flags, "profile");
      if (!name || !role || !profileId)
        throw new Error("Usage: polymux team create NAME --role ROLE --profile PROFILE [--avatar-shape SHAPE] [--avatar-color #RRGGBB] [--laptop ask|off]");
      const member = await client.call<BotDto>("team.create", [{
        name, role, profileId,
        avatar: parseAvatarOption(flagString(flags, "avatar-shape"), flagString(flags, "avatar-color")),
        laptopAccess: parseLaptopAccess(flagString(flags, "laptop")),
      }]);
      stdout.write(`Created ${member.name} (${member.id}).\n`);
      return;
    }
    case "update": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux team update ID [--name NAME] [--role ROLE] [--profile PROFILE] [--laptop ask|off]");
      const member = await resolveMember(client, id);
      const patch: Record<string, unknown> = {};
      const name = flagString(flags, "name");
      const role = flagString(flags, "role");
      const profileId = flagString(flags, "profile");
      const laptop = flagString(flags, "laptop");
      if (name !== undefined) patch.name = name;
      if (role !== undefined) patch.role = role;
      if (profileId !== undefined) patch.profileId = profileId;
      if (laptop !== undefined) patch.laptopAccess = parseLaptopAccess(laptop);
      const shape = flagString(flags, "avatar-shape");
      const color = flagString(flags, "avatar-color");
      if (shape !== undefined || color !== undefined) {
        patch.avatar = parseAvatarOption(
          shape ?? member.avatar.shape,
          color ?? member.avatar.color,
        );
      }
      if (!Object.keys(patch).length) throw new Error("Nothing to update. Pass --name, --role, --profile, --laptop, or avatar flags.");
      const updated = await client.call<BotDto>("team.update", [member.id, patch as JsonValue]);
      stdout.write(`Updated ${updated.name}.\n`);
      return;
    }
    case "remove": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux team remove ID");
      const member = await resolveMember(client, id);
      const removed = await client.call<boolean>("team.remove", [member.id]);
      stdout.write(removed ? `Removed ${member.name}.\n` : `${member.name} no longer exists.\n`);
      return;
    }
    case "send": {
      const [to, ...textParts] = flags.positional;
      const text = textParts.join(" ").trim();
      if (!to || !text) throw new Error("Usage: polymux team send TO TEXT...");
      const message = await client.call<MessageDto>("team.send", [{to, text}]);
      stdout.write(`Sent ${message.id}.\n`);
      return;
    }
    case "read": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux team read ID");
      const member = await resolveMember(client, id);
      await client.call<BotDto>("team.markRead", [member.id]);
      stdout.write(`Marked ${member.name} as read.\n`);
      return;
    }
    case "export": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux team export ID");
      const member = await resolveMember(client, id);
      const transfer = await client.call<unknown>("team.export", [member.id]);
      stdout.write(`${JSON.stringify(transfer, null, 2)}\n`);
      return;
    }
    case "import": {
      const [file, profileId] = flags.positional;
      if (!file || !profileId) throw new Error("Usage: polymux team import FILE PROFILE_ID");
      const transfer = JSON.parse(await readFile(file, "utf8"));
      const member = await client.call<BotDto>("team.import", [transfer, profileId]);
      stdout.write(`Imported ${member.name} (${member.id}).\n`);
      return;
    }
    case "computer": {
      const [action, id] = flags.positional;
      if ((action !== "start" && action !== "stop") || !id)
        throw new Error("Usage: polymux team computer start|stop ID");
      const member = await resolveMember(client, id);
      const updated = await client.call<BotDto>(
        action === "start" ? "team.startComputer" : "team.stopComputer", [member.id],
      );
      stdout.write(`${updated.name}: ${updated.computer.state}.\n`);
      return;
    }
    case "leases": {
      const [memberId] = flags.positional;
      const leases = await client.call<LaptopCapabilityLeaseDto[]>(
        "team.leases", memberId ? [memberId] : [],
      );
      if (flags.json) {
        stdout.write(`${JSON.stringify(leases, null, 2)}\n`);
        return;
      }
      if (!leases.length) {
        stdout.write("No active laptop leases.\n");
        return;
      }
      for (const lease of leases)
        stdout.write(`${lease.id}\t${lease.memberId}\t${lease.capabilities.join(",")}\texpires ${lease.expiresAt}\n`);
      return;
    }
    case "grant-lease": {
      const [member, ...capabilities] = flags.positional;
      if (!member || !capabilities.length)
        throw new Error("Usage: polymux team grant-lease MEMBER browser|computer|files [--minutes N]");
      const minutes = flagString(flags, "minutes");
      const lease = await client.call<LaptopCapabilityLeaseDto>("team.grantLease", [
        (await resolveMember(client, member)).id,
        capabilities,
        minutes === undefined ? undefined : Number(minutes),
      ]);
      stdout.write(`Granted lease ${lease.id} until ${lease.expiresAt}.\n`);
      return;
    }
    case "revoke-lease": {
      const [leaseId] = flags.positional;
      if (!leaseId) throw new Error("Usage: polymux team revoke-lease LEASE_ID");
      const revoked = await client.call<boolean>("team.revokeLease", [leaseId]);
      stdout.write(revoked ? "Lease revoked.\n" : "Lease not found.\n");
      return;
    }
    default: throw new Error(`Unknown team command “${subcommand}”. Run polymux help.`);
  }
}

function listTeam(members: BotDto[]): void {
  if (!members.length) {
    stdout.write("No bots yet. Add one from Polymux Desktop after pairing.\n");
    return;
  }
  for (const member of members)
    stdout.write(`${member.name}\t${member.status}\t${member.role}\n`);
}

async function runOnce(target: string | undefined, argv: string[]): Promise<void> {
  const flags = parseFlags(argv);
  const prompt = flags.positional.join(" ").trim();
  if (!target || !prompt)
    throw new Error("Usage: polymux run <bot|conversation> <instruction> [--reasoning EFFORT] [--as-goal]");
  const reasoning = flagString(flags, "reasoning");
  if (reasoning !== undefined && !REASONING_EFFORTS.has(reasoning))
    throw new Error(`Unknown reasoning effort “${reasoning}”. Use off, minimal, low, medium, high, xhigh, or max.`);
  const client = await adminClient();
  const conversationId = await resolveConversation(client, target);
  const started = await client.call<{runId: string}>("runs.start", [{
    conversationId,
    text: prompt,
    messageId: randomUUID(),
    attachments: [],
    ...(reasoning === undefined ? {} : {reasoning}),
    ...(flags["as-goal"] ? {asGoal: true} : {}),
  }]);
  await waitForRun(client, conversationId, started.runId);
}

async function interactiveChat(target?: string): Promise<void> {
  const root = hostPaths().root;
  await ensureTuiHost({entry: fileURLToPath(import.meta.url), root, ready: () => localHostReady(root)});
  const client = await adminClient();
  if (!target) { await runTui(client, undefined, undefined, {account: accountRequest}); return; }
  const id = await resolveConversation(client, target);
  await runTui(client, {id, title: await conversationLabel(client, target, id)}, undefined, {account: accountRequest});
}

async function chat(target: string | undefined): Promise<void> {
  if (!target) throw new Error("Usage: polymux chat <bot|conversation>");
  const client = await adminClient();
  const conversationId = await resolveConversation(client, target);
  const label = await conversationLabel(client, target, conversationId);
  const input = createInterface({input: stdin, output: stdout});
  stdout.write(`Chatting with ${label}. Type /exit to finish.\n`);
  try {
    while (true) {
      const text = (await input.question("> ")).trim();
      if (!text) continue;
      if (text === "/exit" || text === "/quit") return;
      const started = await client.call<{runId: string}>("runs.start", [{
        conversationId,
        text,
        messageId: randomUUID(),
        attachments: [],
      }]);
      await waitForRun(client, conversationId, started.runId);
    }
  } finally {
    input.close();
  }
}

async function conversationsCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "list": {
      const method = flags.archived ? "conversations.listArchived" : "conversations.list";
      const conversations = await client.call<ConversationDto[]>(method);
      if (flags.json) {
        stdout.write(`${JSON.stringify(conversations, null, 2)}\n`);
        return;
      }
      if (!conversations.length) {
        stdout.write(flags.archived ? "No archived chats.\n" : "No assistant chats yet.\n");
        return;
      }
      for (const conversation of conversations)
        stdout.write(`${conversation.id}\t${conversation.title}\n`);
      return;
    }
    case "create": {
      const title = flags.positional.join(" ").trim() || "Assistant";
      const conversation = await client.call<ConversationDto>("conversations.create", [title]);
      stdout.write(`${conversation.id}\t${conversation.title}\n`);
      return;
    }
    case "ensure": {
      const [id, ...titleParts] = flags.positional;
      if (!id) throw new Error("Usage: polymux conversations ensure ID [TITLE]");
      const conversation = await client.call<ConversationDto>(
        "assistant.ensure", titleParts.length ? [id, titleParts.join(" ")] : [id],
      );
      stdout.write(`${conversation.id}\t${conversation.title}\n`);
      return;
    }
    case "rename": {
      const [id, ...titleParts] = flags.positional;
      const title = titleParts.join(" ").trim();
      if (!id || !title) throw new Error("Usage: polymux conversations rename ID TITLE");
      const conversation = await client.call<ConversationDto>("conversations.rename", [id, title]);
      stdout.write(`${conversation.id}\t${conversation.title}\n`);
      return;
    }
    case "archive":
    case "unarchive":
    case "remove":
    case "duplicate": {
      const [id] = flags.positional;
      if (!id) throw new Error(`Usage: polymux conversations ${subcommand} ID`);
      const method = subcommand === "duplicate" ? "conversations.duplicate" : `conversations.${subcommand}`;
      const result = await client.call<unknown>(method, [id]);
      stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    case "messages": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux conversations messages ID");
      const messages = await client.call<MessageDto[]>("conversations.messages", [id]);
      if (flags.json) {
        stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
        return;
      }
      for (const message of messages) {
        const text = assistantText(message.content);
        stdout.write(`[${message.role}] ${text || "(no text)"}\n`);
      }
      return;
    }
    default: throw new Error(`Unknown conversations command “${subcommand}”. Run polymux help.`);
  }
}

async function goalsCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  const actions = new Set(["view", "create", "update", "pause", "resume", "clear"]);
  if (!actions.has(subcommand) && subcommand !== "get")
    throw new Error(`Unknown goals command “${subcommand}”. Use get, view, create, update, pause, resume, or clear.`);
  const action = subcommand === "get" ? "view" : subcommand;
  const [conversationId, ...objectiveParts] = flags.positional;
  if (!conversationId) throw new Error("Usage: polymux goals get|view|pause|resume|clear|create|update CONVERSATION_ID [--objective TEXT]");
  const objective = (flagString(flags, "objective") ?? objectiveParts.join(" ").trim()) || null;
  if ((action === "create" || action === "update") && !objective)
    throw new Error(`Usage: polymux goals ${action} CONVERSATION_ID --objective TEXT`);
  if (action === "view") {
    const goal = await client.call<GoalDto | null>("goals.get", [conversationId]);
    if (!goal) {
      stdout.write(flags.json ? "null\n" : "No goal for this conversation.\n");
      return;
    }
    stdout.write(flags.json ? `${JSON.stringify(goal, null, 2)}\n` : `${goal.status}: ${goal.objective}\n`);
    return;
  }
  const result = await client.call<unknown>("goals.execute", [{
    conversationId, action, ...(objective ? {objective} : {}),
  }]);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runsCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "active": {
      const method = flags.all ? "runs.activeAll" : "runs.active";
      const runs = await client.call<unknown>(method);
      stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
      return;
    }
    case "cancel": {
      const [runId] = flags.positional;
      if (!runId) throw new Error("Usage: polymux runs cancel RUN_ID");
      await client.call<null>("runs.cancel", [runId]);
      stdout.write("Run cancelled.\n");
      return;
    }
    case "steer": {
      const [runId, ...textParts] = flags.positional;
      const text = textParts.join(" ").trim();
      if (!runId || !text) throw new Error("Usage: polymux runs steer RUN_ID TEXT...");
      await client.call<null>("runs.steer", [runId, text, randomUUID()]);
      stdout.write("Steered.\n");
      return;
    }
    case "events": {
      const [runId, after] = flags.positional;
      if (!runId) throw new Error("Usage: polymux runs events RUN_ID [AFTER_SEQUENCE]");
      const events = await client.call<RunEventDto[]>(
        "runs.events", after === undefined ? [runId] : [runId, Number(after)],
      );
      stdout.write(`${JSON.stringify(events, null, 2)}\n`);
      return;
    }
    default: throw new Error(`Unknown runs command “${subcommand}”. Run polymux help.`);
  }
}

async function hubCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "chats": {
      const chats = await client.call<Array<{id: string; name: string; platform: string; unread?: boolean}>>("hub.chats");
      if (flags.json) {
        stdout.write(`${JSON.stringify(chats, null, 2)}\n`);
        return;
      }
      if (!chats.length) {
        stdout.write("No chats linked. Link a messaging account from Polymux Desktop first.\n");
        return;
      }
      for (const chat of chats)
        stdout.write(`${chat.id}\t${chat.name}\t${chat.platform}${chat.unread ? "\t(unread)" : ""}\n`);
      return;
    }
    case "messages": {
      const [chatId, limit, before] = flags.positional;
      if (!chatId) throw new Error("Usage: polymux hub messages CHAT_ID [LIMIT] [BEFORE]");
      const page = await client.call<{messages: Array<{senderName: string; body: string}>; nextBefore: string | null}>(
        "hub.messages",
        before !== undefined ? [chatId, limit === undefined ? 50 : Number(limit), before]
          : limit === undefined ? [chatId] : [chatId, Number(limit)],
      );
      if (flags.json) {
        stdout.write(`${JSON.stringify(page, null, 2)}\n`);
        return;
      }
      for (const message of page.messages)
        stdout.write(`${message.senderName}: ${message.body}\n`);
      if (page.nextBefore) stdout.write(`-- more: polymux hub messages ${chatId} 50 ${page.nextBefore}\n`);
      return;
    }
    case "mark-read": {
      const [chatId, messageId] = flags.positional;
      if (!chatId || !messageId) throw new Error("Usage: polymux hub mark-read CHAT_ID MESSAGE_ID");
      await client.call<boolean>("hub.markRead", [chatId, messageId]);
      stdout.write("Marked as read.\n");
      return;
    }
    case "send": {
      const [chatId, ...textParts] = flags.positional;
      const text = textParts.join(" ").trim();
      if (!chatId || !text) throw new Error("Usage: polymux hub send CHAT_ID TEXT...");
      const message = await client.call<{id: string}>("hub.send", [chatId, text]);
      stdout.write(`Sent ${message.id}.\n`);
      return;
    }
    case "send-files": {
      const [chatId, ...files] = flags.positional;
      if (!chatId || !files.length) throw new Error("Usage: polymux hub send-files CHAT_ID FILE...");
      if (files.length > 6) throw new Error("Send at most six files at once");
      const attachments = [];
      for (const file of files) {
        const bytes = await readFile(file);
        if (bytes.byteLength > 12 * 1024 * 1024) throw new Error(`${file} is larger than 12 MB`);
        attachments.push({
          name: path.basename(file),
          mimeType: mimeTypeFor(file),
          data: bytes.toString("base64"),
        });
      }
      await client.call<null>("hub.sendFiles", [chatId, attachments]);
      stdout.write("Sent.\n");
      return;
    }
    case "email-accounts": {
      const accounts = await client.call<unknown>("hub.emailAccounts");
      stdout.write(`${JSON.stringify(accounts, null, 2)}\n`);
      return;
    }
    case "email-save": {
      const request = emailAccountRequest(flags);
      const password = await secretOption(flags, "password-value", "POLYMUX_EMAIL_PASSWORD", "Mailbox password", false);
      if (password !== undefined) request.password = password;
      const accounts = await client.call<unknown>("hub.saveEmailAccount", [request as JsonValue]);
      stdout.write(`${JSON.stringify(accounts, null, 2)}\n`);
      return;
    }
    case "email-remove": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux hub email-remove ID");
      const accounts = await client.call<unknown>("hub.removeEmailAccount", [id]);
      stdout.write(`${JSON.stringify(accounts, null, 2)}\n`);
      return;
    }
    case "email-test": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux hub email-test ID");
      const account = await client.call<unknown>("hub.testEmailAccount", [id]);
      stdout.write(`${JSON.stringify(account, null, 2)}\n`);
      return;
    }
    default: throw new Error(`Unknown hub command “${subcommand}”. Run polymux help.`);
  }
}

function emailAccountRequest(flags: ParsedFlags): Record<string, unknown> {
  const [id] = flags.positional;
  const request: Record<string, unknown> = {};
  if (id !== undefined) request.id = id;
  const textFields: Record<string, string> = {
    "original-id": "originalId",
    email: "email",
    preset: "preset",
    "display-name": "displayName",
    "imap-host": "imapHost",
    "imap-login": "imapLogin",
    "smtp-host": "smtpHost",
    "smtp-login": "smtpLogin",
    "imap-encryption": "imapEncryption",
    "smtp-encryption": "smtpEncryption",
  };
  for (const [flag, key] of Object.entries(textFields)) {
    const value = flagString(flags, flag);
    if (value !== undefined) request[key] = value;
  }
  for (const [flag, key] of [["imap-port", "imapPort"], ["smtp-port", "smtpPort"]] as const) {
    const value = flagString(flags, flag);
    if (value !== undefined) request[key] = Number(value);
  }
  if (request.id === undefined) throw new Error("Usage: polymux hub email-save ID --email ADDR --preset PRESET --imap-host HOST --smtp-host HOST [--password-value-stdin|--password-value-prompt] …");
  return request;
}

function mimeTypeFor(file: string): string {
  const extension = path.extname(file).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".heic": return "image/heic";
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".pdf": return "application/pdf";
    case ".txt":
    case ".md": return "text/plain";
    case ".html": return "text/html";
    default: return "application/octet-stream";
  }
}

async function lockerCommand(subcommand: string, rest: string[]): Promise<void> {
  const client = await adminClient();
  const flags = parseFlags(rest);
  switch (subcommand) {
    case "status": {
      const status = await client.call<unknown>("locker.status");
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case "create":
    case "unlock": {
      const password = await secretOption(flags, "password", "POLYMUX_LOCKER_PASSWORD", "Locker password");
      const status = await client.call<unknown>(
        subcommand === "create" ? "locker.create" : "locker.unlock", [password],
      );
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case "lock":
    case "list":
    case "codes":
    case "empty-trash":
    case "sync":
    case "export": {
      const method = subcommand === "empty-trash" ? "locker.emptyTrash" : `locker.${subcommand}`;
      const result = await client.call<unknown>(method);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "reveal":
    case "totp":
    case "otpauth": {
      const [id] = flags.positional;
      if (!id) throw new Error(`Usage: polymux locker ${subcommand} ID`);
      const result = await client.call<unknown>(`locker.${subcommand}`, [id]);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "copy": {
      const [id, field, index] = flags.positional;
      if (!id || !field) throw new Error("Usage: polymux locker copy ID password|username|url|totp|notes|recovery [INDEX]");
      const result = await client.call<string>(
        "locker.copy", index === undefined ? [id, field] : [id, field, Number(index)],
      );
      stdout.write(`${result}\n`);
      return;
    }
    case "save": {
      const item: Record<string, unknown> = {};
      const [positionalId] = flags.positional;
      const flagId = flagString(flags, "id");
      if (flagId !== undefined && positionalId !== undefined && flagId !== positionalId)
        throw new Error("Pass only one Locker item ID.");
      const id = flagId ?? positionalId;
      if (id !== undefined) item.id = id;
      const title = flagString(flags, "title");
      if (title === undefined) throw new Error("Usage: polymux locker save [--id ID] --title TITLE [--username U] [--password-value-stdin|--password-value-prompt] [--url URL] [--notes N] [--totp SECRET] [--group GROUP]");
      item.title = title;
      for (const key of ["username", "url", "notes", "group"] as const) {
        const value = flagString(flags, key);
        if (value !== undefined) item[key === "group" ? "groupName" : key] = value;
      }
      const secret = await secretOption(flags, "password-value", "POLYMUX_LOCKER_ITEM_PASSWORD", "Item password", false);
      if (secret !== undefined) item.password = secret;
      const totp = flagString(flags, "totp");
      if (totp !== undefined) item.totpSecret = totp;
      const saved = await client.call<unknown>("locker.save", [item as JsonValue]);
      stdout.write(`${JSON.stringify(saved, null, 2)}\n`);
      return;
    }
    case "remove": {
      const [id] = flags.positional;
      if (!id) throw new Error("Usage: polymux locker remove ID");
      const result = await client.call<unknown>("locker.remove", [id]);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "restore":
    case "purge": {
      if (!flags.positional.length) throw new Error(`Usage: polymux locker ${subcommand} ID...`);
      const result = await client.call<unknown>(`locker.${subcommand}`, [flags.positional]);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "pin": {
      if (!flags.positional.length) throw new Error("Usage: polymux locker pin ID... [--unpin]");
      const result = await client.call<unknown>("locker.pin", [flags.positional, flags.unpin ? false : true]);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "reorder": {
      if (!flags.positional.length) throw new Error("Usage: polymux locker reorder ID... (in the new order)");
      const result = await client.call<unknown>("locker.reorder", [flags.positional]);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "change-password": {
      if (flags["current-stdin"] && flags["new-stdin"])
        throw new Error("Only one password can be read from stdin per command.");
      const current = await secretOption(flags, "current", "POLYMUX_LOCKER_PASSWORD", "Current Locker password");
      const next = await secretOption(flags, "new", "POLYMUX_LOCKER_NEW_PASSWORD", "New Locker password");
      const status = await client.call<unknown>("locker.changePassword", [current, next]);
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case "set-storage": {
      const [mode, resolve] = flags.positional;
      if (!mode) throw new Error("Usage: polymux locker set-storage local|account [keep-local|keep-cloud]");
      const status = await client.call<unknown>(
        "locker.setStorage", resolve === undefined ? [mode] : [mode, resolve],
      );
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    case "import": {
      const [file] = flags.positional;
      if (!file) throw new Error("Usage: polymux locker import FILE (a locker export JSON file)");
      const blob = JSON.parse(await readFile(file, "utf8"));
      const status = await client.call<unknown>("locker.import", [blob]);
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }
    default: throw new Error(`Unknown locker command “${subcommand}”. Run polymux help.`);
  }
}

async function secretOption(
  flags: ParsedFlags,
  flag: string,
  environment: string,
  label: string,
  required = true,
): Promise<string | undefined> {
  const literal = flagString(flags, flag);
  const fromStdin = flags[`${flag}-stdin`] === true;
  const prompt = flags[`${flag}-prompt`] === true;
  if (Number(literal !== undefined) + Number(fromStdin) + Number(prompt) > 1)
    throw new Error(`Choose one of --${flag}, --${flag}-stdin, or --${flag}-prompt.`);
  let value: string | undefined;
  if (fromStdin) value = await secretFromStdin();
  else if (literal !== undefined) value = literal;
  else if (!prompt && process.env[environment] !== undefined) value = process.env[environment];
  else if (prompt || required) {
    if (!stdin.isTTY)
      throw new Error(`Set ${environment} or pipe the password with --${flag}-stdin.`);
    value = await promptSecret(label);
  }
  if (required && !value) throw new Error(`${label} is required.`);
  return value;
}

async function callMethod(method: string | undefined, jsonArgs: string): Promise<void> {
  if (!method) throw new Error("Usage: polymux call METHOD [JSON_ARGS]");
  let args: unknown[] = [];
  if (jsonArgs.trim()) {
    const parsed = JSON.parse(jsonArgs);
    args = Array.isArray(parsed) ? parsed : [parsed];
  }
  const result = await (await adminClient()).call<unknown>(
    method, args as JsonValue[],
  );
  stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
}

async function waitForRun(
  client: TeamHostClient,
  conversationId: string,
  runId: string,
): Promise<void> {
  let sequence = 0;
  while (true) {
    const events = await client.call<RunEventDto[]>("runs.events", [runId, sequence]);
    for (const event of events) sequence = Math.max(sequence, event.sequence);
    const terminal = events.find((event) =>
      event.type === "run.completed" || event.type === "run.cancelled" || event.type === "run.failed",
    );
    if (terminal) {
      const messages = await client.call<MessageDto[]>("conversations.messages", [conversationId]);
      const answer = [...messages].reverse().find((message) =>
        message.runId === runId && message.role === "assistant",
      );
      const text = assistantText(answer?.content);
      if (text) stdout.write(`${text}\n`);
      if (terminal.type !== "run.completed")
        throw new Error(terminal.type === "run.cancelled" ? "Run was cancelled" : "Run failed");
      return;
    }
    await delay(250);
  }
}

async function resolveMember(client: TeamHostClient, target: string): Promise<BotDto> {
  const normalized = target.normalize("NFKC").toLocaleLowerCase();
  const members = await client.call<BotDto[]>("team.list");
  const member = members.find((candidate) =>
    candidate.id === target
    || candidate.conversationId === target
    || candidate.name.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (!member) throw new Error(`No bot matches “${target}”`);
  return member;
}

/** Bots and Assistant chats share one run pipeline; accept either as a target. */
async function resolveConversation(client: TeamHostClient, target: string): Promise<string> {
  const normalized = target.normalize("NFKC").toLocaleLowerCase();
  const members = await client.call<BotDto[]>("team.list");
  const member = members.find((candidate) =>
    candidate.id === target
    || candidate.conversationId === target
    || candidate.name.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (member) return member.conversationId;
  const conversations = await client.call<ConversationDto[]>("conversations.list");
  const conversation = conversations.find((candidate) =>
    candidate.id === target || candidate.title.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (conversation) return conversation.id;
  const archived = await client.call<ConversationDto[]>("conversations.listArchived");
  const match = archived.find((candidate) =>
    candidate.id === target || candidate.title.normalize("NFKC").toLocaleLowerCase() === normalized,
  );
  if (match) return match.id;
  throw new Error(`No bot or chat matches “${target}”`);
}

async function conversationLabel(
  client: TeamHostClient,
  target: string,
  conversationId: string,
): Promise<string> {
  const members = await client.call<BotDto[]>("team.list");
  const member = members.find((candidate) =>
    candidate.conversationId === conversationId || candidate.id === target,
  );
  if (member) return member.name;
  const conversations = await client.call<ConversationDto[]>("conversations.list");
  return conversations.find((candidate) => candidate.id === conversationId)?.title ?? target;
}

export interface ParsedFlags {
  positional: string[];
  [key: string]: string | boolean | string[];
}

const BOOLEAN_FLAGS = new Set([
  "json", "archived", "all", "as-goal", "unpin", "pairing", "start",
  ...["password", "password-value", "current", "new"].flatMap((name) => [
    `${name}-stdin`, `${name}-prompt`,
  ]),
]);

/** Boolean flags never consume positional arguments; other options take a value. */
export function parseFlags(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: ParsedFlags = {positional};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith("--") && token.length > 2) {
      const inline = token.indexOf("=");
      const rawName = token.slice(2, inline < 0 ? undefined : inline);
      const negated = rawName.startsWith("no-") && rawName.length > 3;
      const name = negated ? rawName.slice(3) : rawName;
      if (negated || BOOLEAN_FLAGS.has(name)) {
        const value = inline < 0 ? "true" : token.slice(inline + 1);
        if (value !== "true" && value !== "false")
          throw new Error(`--${rawName} expects true or false.`);
        flags[name] = negated ? value === "false" : value === "true";
        index += 1;
        continue;
      }
      if (inline >= 0) {
        setFlag(flags, name, token.slice(inline + 1));
        index += 1;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        if (name !== "relay") throw new Error(`--${name} requires a value.`);
        flags[name] = true;
        index += 1;
        continue;
      }
      setFlag(flags, name, next);
      index += 2;
      continue;
    }
    positional.push(token);
    index += 1;
  }
  return flags;
}

function setFlag(flags: ParsedFlags, name: string, value: string): void {
  const existing = flags[name];
  if (existing === undefined) flags[name] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else flags[name] = [existing as string, value];
}

export function flagString(flags: ParsedFlags, name: string): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[value.length - 1];
  return undefined;
}

const REASONING_EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

const AVATAR_SHAPES = new Set([
  "circle", "pebble", "squircle", "capsule", "triangle", "hexagon", "cube", "cloud", "droplet",
]);

export function parseAvatarOption(
  shape: string | undefined,
  color: string | undefined,
): {shape: string; color: string} {
  const resolvedShape = (shape ?? "circle").toLowerCase();
  const resolvedColor = (color ?? "#7557ff").toUpperCase();
  if (!AVATAR_SHAPES.has(resolvedShape))
    throw new Error(`Unknown avatar shape “${shape}”. Use circle, pebble, squircle, capsule, triangle, hexagon, cube, cloud, or droplet.`);
  if (!/^#[0-9A-F]{6}$/.test(resolvedColor))
    throw new Error("Avatar colour must be a six-digit hex colour such as #7557ff.");
  return {shape: resolvedShape, color: resolvedColor};
}

export function parseLaptopAccess(value: string | undefined): "off" | "ask" {
  if (value === undefined || value === "off") return "off";
  if (value === "ask") return "ask";
  throw new Error('Laptop access must be "off" or "ask".');
}

export function parseConnectTarget(value: string): {kind: "setup-code"} | {kind: "invitation"} | {kind: "unknown"} {
  if (!value) return {kind: "unknown"};
  if (parseTeamHostSetupCode(value)) return {kind: "setup-code"};
  try {
    parseDeviceInvitation(value);
    return {kind: "invitation"};
  } catch {
    return {kind: "unknown"};
  }
}

async function adminClient(): Promise<TeamHostClient> {
  const paths = hostPaths();
  const [state, secret] = await Promise.all([
    readState(),
    readFile(paths.adminSecret, "utf8").then((value) => value.trim()),
  ]);
  if (!secret) throw new Error("Host administration token is missing");
  return new TeamHostClient(state.localEndpoint ?? state.endpoint, secret);
}

async function accountRequest<T>(request: Record<string, JsonValue>): Promise<T> {
  const client = await adminClient();
  const endpoint = new URL(client.endpoint);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Account commands must use the local Host endpoint. Run them on the Host computer.');
  const response = await fetch(`${client.endpoint}/polymux-host/v1/admin/account`, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${client.secret}`},
    body: JSON.stringify(request), signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) throw new Error('Update and restart the Host with this CLI build to enable account sign-in.');
  const value = await response.json() as {result?: T; error?: string};
  if (!response.ok) throw new Error(value.error || 'Account request failed.');
  return value.result as T;
}

async function installService(start: boolean, showCode = true): Promise<void> {
  const entry = fileURLToPath(import.meta.url);
  if (entry.endsWith(".ts"))
    throw new Error("Build or install the Polymux CLI before installing its background service");
  const paths = hostPaths();
  await mkdir(paths.data, {recursive: true, mode: 0o700});
  await mkdir(paths.config, {recursive: true, mode: 0o700});
  await loadOrCreateSecret(paths.adminSecret);
  if (process.platform === "linux") {
    const unitDirectory = path.join(homedir(), ".config", "systemd", "user");
    const unit = path.join(unitDirectory, "polymux-host.service");
    await mkdir(unitDirectory, {recursive: true});
    await writeFile(unit, linuxUnit(entry, paths), {encoding: "utf8", mode: 0o600});
    await runCommand("systemctl", ["--user", "daemon-reload"]);
    if (start) {
      await runCommand("systemctl", ["--user", "enable", "polymux-host.service"]);
      await runCommand("systemctl", ["--user", "restart", "polymux-host.service"]);
    }
  } else if (process.platform === "darwin") {
    const agents = path.join(homedir(), "Library", "LaunchAgents");
    const plist = path.join(agents, "com.polymux.host.plist");
    await mkdir(agents, {recursive: true});
    await writeFile(plist, macPlist(entry, paths), {encoding: "utf8", mode: 0o600});
    if (start) {
      await runCommand("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plist], true);
      await runCommand("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plist]);
    }
  } else {
    throw new Error("Automatic Host service installation currently supports Linux and macOS");
  }
  stdout.write(`Installed Polymux Host service${start ? " and started it" : ""}.\n`);
  if (start) {
    await waitForState();
    if (showCode) await showPairing();
  }
}

async function uninstallService(): Promise<void> {
  if (process.platform === "linux") {
    await runCommand("systemctl", ["--user", "disable", "--now", "polymux-host.service"], true);
    await rm(path.join(homedir(), ".config", "systemd", "user", "polymux-host.service"), {force: true});
    await runCommand("systemctl", ["--user", "daemon-reload"], true);
  } else if (process.platform === "darwin") {
    const plist = path.join(homedir(), "Library", "LaunchAgents", "com.polymux.host.plist");
    await runCommand("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plist], true);
    await rm(plist, {force: true});
  } else {
    throw new Error("Automatic Host service removal currently supports Linux and macOS");
  }
  stdout.write("Removed the Polymux Host background service. Host data was kept.\n");
}

async function controlService(action: "start" | "stop" | "restart"): Promise<void> {
  if (process.platform === "linux") {
    await runCommand("systemctl", ["--user", action, "polymux-host.service"]);
  } else if (process.platform === "darwin") {
    const label = "com.polymux.host";
    const domain = `gui/${process.getuid?.() ?? 0}`;
    const service = `${domain}/${label}`;
    const plist = path.join(homedir(), "Library", "LaunchAgents", "com.polymux.host.plist");
    if (action === "stop") {
      await runCommand("launchctl", ["bootout", service]);
    } else if (action === "start") {
      await runCommand("launchctl", ["bootstrap", domain, plist], true);
      await runCommand("launchctl", ["kickstart", service]);
    } else {
      await runCommand("launchctl", ["kickstart", "-k", service]);
    }
  } else {
    throw new Error("Host service control currently supports Linux and macOS");
  }
}

function linuxUnit(entry: string, paths: ReturnType<typeof hostPaths>): string {
  return `[Unit]\nDescription=Polymux Host\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${systemdQuote(process.execPath)} ${systemdQuote(entry)} host serve\nRestart=on-failure\nRestartSec=3\nEnvironment=POLYMUX_HOME=${systemdQuote(paths.root)}\nEnvironmentFile=-${systemdQuote(path.join(paths.config, "host.env"))}\n\n[Install]\nWantedBy=default.target\n`;
}

function macPlist(entry: string, paths: ReturnType<typeof hostPaths>): string {
  const log = path.join(paths.data, "host.log");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.polymux.host</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(entry)}</string><string>host</string><string>serve</string></array><key>EnvironmentVariables</key><dict><key>POLYMUX_HOME</key><string>${xml(paths.root)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
}


async function loadOrCreateSecret(file: string): Promise<string> {
  const existing = await readFile(file, "utf8").catch(() => "");
  if (existing.trim()) return existing.trim();
  const secret = randomBytes(32).toString("base64url");
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${secret}\n`, {encoding: "utf8", mode: 0o600});
  await rename(temporary, file);
  return secret;
}

async function loadEnvironmentFile(file: string): Promise<void> {
  const source = await readFile(file, "utf8").catch(() => "");
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || process.env[name] !== undefined) continue;
    const encoded = line.slice(separator + 1).trim();
    const value = encoded.length >= 2 && (
      (encoded.startsWith('"') && encoded.endsWith('"'))
      || (encoded.startsWith("'") && encoded.endsWith("'"))
    ) ? encoded.slice(1, -1) : encoded;
    process.env[name] = value;
  }
}

async function writeState(file: string, snapshot: TeamHostServerSnapshot): Promise<void> {
  if (!snapshot.endpoint) return;
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify({
    endpoint: snapshot.endpoint,
    localEndpoint: snapshot.localEndpoint ?? null,
    pairingCode: snapshot.pairingCode,
    pairedDesktopName: snapshot.pairedDesktopName,
    updatedAt: new Date().toISOString(),
  }, null, 2), {encoding: "utf8", mode: 0o600});
  await rename(temporary, file);
}

async function readState(): Promise<{endpoint: string; localEndpoint: string | null}> {
  const value = JSON.parse(await readFile(hostPaths().state, "utf8")) as {endpoint?: unknown; localEndpoint?: unknown};
  if (typeof value.endpoint !== "string" || !value.endpoint)
    throw new Error("Host state is unavailable. Start it with polymux host start.");
  return {
    endpoint: value.endpoint,
    localEndpoint: typeof value.localEndpoint === "string" && value.localEndpoint ? value.localEndpoint : null,
  };
}

async function waitForState(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (existsSync(hostPaths().state)) return;
    await delay(250);
  }
  throw new Error("Host service was installed but did not become ready");
}

export function hostNetworkOptions(flags: ParsedFlags, environment: NodeJS.ProcessEnv = process.env) {
  const explicitListen = (flagString(flags, "listen") ?? environment.POLYMUX_HOST_LISTEN?.trim()) || null;
  const publicEndpoint = (flagString(flags, "public-endpoint") ?? environment.POLYMUX_HOST_PUBLIC_ENDPOINT?.trim()) || null;
  return {
    listen: explicitListen ?? "127.0.0.1",
    publicEndpoint,
    relayEndpoint: serveRelayEndpoint(flags, publicEndpoint, explicitListen, environment),
  };
}

function serveRelayEndpoint(
  flags: ParsedFlags,
  publicEndpoint: string | null,
  explicitListen: string | null,
  environment: NodeJS.ProcessEnv,
): string | null {
  if (flags.relay !== undefined) {
    if (flags.relay === false) return null;
    const value = flagString(flags, "relay");
    if (value === undefined) return hostRelayEndpoint(publicEndpoint, explicitListen, environment);
    const trimmed = value.trim();
    return !trimmed || trimmed === "0" || trimmed.toLowerCase() === "off" ? null : trimmed;
  }
  return hostRelayEndpoint(publicEndpoint, explicitListen, environment);
}

function hostRelayEndpoint(publicEndpoint: string | null, explicitListen: string | null, environment: NodeJS.ProcessEnv): string | null {
  const configured = environment.POLYMUX_HOST_RELAY_ENDPOINT;
  if (configured !== undefined) {
    const value = configured.trim();
    return !value || value === "0" || value.toLowerCase() === "off" ? null : value;
  }
  return publicEndpoint || explicitListen ? null : "https://connect.polymux.com";
}

function hostPort(value: string | undefined): number {
  if (!value?.trim()) return 47_680;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("POLYMUX_HOST_PORT must be an integer from 1 to 65535");
  return parsed;
}

function assistantText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return [];
    const value = block as Record<string, unknown>;
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n\n").trim();
}

function printSnapshot(snapshot: TeamHostServerSnapshot, interactive = Boolean(stdout.isTTY)): void {
  stdout.write(snapshotText(snapshot, interactive));
}

function snapshotText(snapshot: TeamHostServerSnapshot, interactive: boolean): string {
  let output = `Polymux Host is running at ${snapshot.endpoint ?? "an unavailable endpoint"}.\n`;
  if (snapshot.endpoint && snapshot.pairingCode) {
    const setupCode = formatTeamHostSetupCode(snapshot.endpoint, snapshot.pairingCode);
    if (interactive) output += `\nScan with Polymux on your other device:\n\n${terminalQr(setupCode)}\n\n`;
    output += `Connect code: ${snapshot.pairingCode}\n`;
    output += `Setup code: ${setupCode}\n`;
    output += interactive
      ? "Or open Devices → Connect on your other device and enter the connect code.\n"
      : "Open Devices → Connect on your other device and enter the connect code.\n";
  } else if (snapshot.pairedDesktopName)
    output += `Paired Desktop: ${snapshot.pairedDesktopName}\n`;
  if (snapshot.detail) output += `${snapshot.detail}\n`;
  return output;
}

async function runCommand(command: string, commandArgs: string[], allowFailure = false): Promise<void> {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, commandArgs, {stdio: "inherit"});
    child.once("error", reject);
    child.once("close", (value) => resolve(value ?? 1));
  });
  if (code !== 0 && !allowFailure) throw new Error(`${command} exited with code ${code}`);
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printHelp(): void {
  stdout.write(`Polymux CLI ${VERSION}

Usage:
  polymux auth login [google|apple|email] [--email ADDRESS] [--password-stdin] [--no-browser]
  polymux auth status|whoami|logout|sync [--json]
  polymux connect TOKEN|--code CODE [--endpoint URL]|SETUP_CODE
  polymux devices state|invitation|list|approve|revoke|execution|cancel
  polymux host serve [--port N] [--listen ADDR] [--public-endpoint URL] [--relay URL|--no-relay] [--no-pairing] [--model PROVIDER/MODEL]
  polymux host install|uninstall|start|stop|restart|status [--json]|pair
  polymux team list [--json]|profiles|create|update|remove|send|read|export|import
  polymux team computer start|stop ID
  polymux team leases [MEMBER]|grant-lease|revoke-lease
  polymux conversations list [--archived]|create|ensure|rename|archive|unarchive|remove|duplicate|messages
  polymux goals get|view|create|update|pause|resume|clear CONVERSATION_ID [--objective TEXT]
  polymux runs active [--all]|cancel|steer|events
  polymux hub chats|messages|mark-read|send|send-files
  polymux hub email-accounts|email-save|email-remove|email-test
  polymux locker status|create|unlock|lock|list|reveal|totp|otpauth|copy|save
  polymux locker remove|restore|purge|empty-trash|pin|reorder|change-password|codes|sync|set-storage|export|import
  polymux run TARGET PROMPT... [--reasoning EFFORT] [--as-goal]
  polymux [tui [TARGET]]          Fullscreen conversation interface
  polymux chat TARGET             Open a conversation (plain input when piped)
  polymux call METHOD [JSON_ARGS]

Hub chats need a linked account and OAuth mail sign-in needs Polymux Desktop;
password mailboxes and the full Locker work headless.

Passwords:
  locker create/unlock: hidden prompt, --password-stdin, or POLYMUX_LOCKER_PASSWORD
  locker save: --password-value-stdin / --password-value-prompt, or POLYMUX_LOCKER_ITEM_PASSWORD
  hub email-save: --password-value-stdin / --password-value-prompt, or POLYMUX_EMAIL_PASSWORD
  locker change-password: hidden prompts; --current-stdin / --new-stdin for one value,
    or POLYMUX_LOCKER_PASSWORD and POLYMUX_LOCKER_NEW_PASSWORD
Stdin reads until EOF and removes one final line ending, preserving other whitespace.
Existing password value flags remain supported, but put secrets in process arguments.
`);
}

function cliEntryMatches(argument: string | undefined, moduleUrl: string): boolean {
  if (!argument) return false;
  const entry = path.resolve(argument);
  const moduleFile = fileURLToPath(moduleUrl);
  try {
    return realpathSync(entry) === realpathSync(moduleFile);
  } catch {
    return entry === moduleFile;
  }
}

export {
  assistantText,
  cliEntryMatches,
  hostPaths,
  linuxUnit,
  macPlist,
  snapshotText,
  terminalQr,
};

if (cliEntryMatches(process.argv[1], import.meta.url)) {
  try {
    await main(args);
  } catch (error) {
    process.stderr.write(`Polymux: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
