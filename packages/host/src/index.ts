/**
 * Shared Host boundary used by the Electron Desktop and the headless CLI.
 *
 * The existing Team domain modules remain at their original paths while the
 * feature is landing so ongoing Desktop work does not need a destructive file
 * move. New applications import this package rather than reaching into
 * apps/desktop directly.
 */
export {
  TeamHostClient,
  TeamHostServer,
  type TeamDeviceRequest,
  type TeamHostServerSnapshot,
} from "../../../apps/desktop/src/main/team/host-server.js";
export {TeamComputerManager, teamContainerCreateArgs} from "../../../apps/desktop/src/main/team/computers.js";
export {
  TeamService,
  agentRelayInferenceText,
  createAgentMessageTool,
  createTeamSetupTool,
  relayOrigin,
} from "../../../apps/desktop/src/main/team/service.js";
export {ProfileManager, type ExternalProfileSource, type ProfileRecord, type ProfilesSnapshot} from "../../../apps/desktop/src/main/profiles.js";
export {HeadlessHostRuntime, type HeadlessHostRuntimeOptions} from "./runtime.js";
export {TeamHostRelay, type TeamHostRelayOptions} from "../../../apps/desktop/src/main/team/host-relay.js";

export {loadDeviceSecret} from './device-secrets.js';
