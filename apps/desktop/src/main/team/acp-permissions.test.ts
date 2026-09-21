import assert from "node:assert/strict";
import test from "node:test";
import type {PermissionOption} from "@agentclientprotocol/sdk";
import type {DeviceAccessMode} from "@polymux/protocol";
import {requestTeamAcpPermission, teamAcpPermissionResponse} from "./acp-permissions.js";

const options: PermissionOption[] = [
  {optionId: "always", name: "Always allow", kind: "allow_always"},
  {optionId: "reject", name: "Deny", kind: "reject_once"},
  {optionId: "once", name: "Allow once", kind: "allow_once"},
];

test("allowed devices authorize ACP calls without prompting and prefer one-time permission", () => {
  assert.deepEqual(teamAcpPermissionResponse("allow", {options}), {
    outcome: {outcome: "selected", optionId: "once"},
  });
  assert.deepEqual(teamAcpPermissionResponse("allow", {options: options.slice(0, 2)}), {
    outcome: {outcome: "selected", optionId: "always"},
  });
});

test("asked devices require a choice and restricted devices reject ACP calls", () => {
  assert.equal(teamAcpPermissionResponse("ask", {options}), null);
  assert.deepEqual(teamAcpPermissionResponse("off", {options}), {
    outcome: {outcome: "selected", optionId: "reject"},
  });
});

test("missing matching ACP outcomes cancel without selecting an opposite action", () => {
  assert.deepEqual(teamAcpPermissionResponse("allow", {options: [options[1]]}), {outcome: {outcome: "cancelled"}});
  assert.deepEqual(teamAcpPermissionResponse("off", {options: [options[0]]}), {outcome: {outcome: "cancelled"}});
});

test("ACP permissions read the current mode for every request without prompting on allowed devices", async () => {
  let mode: DeviceAccessMode = "allow";
  let prompts = 0;
  const ask = async () => {
    prompts += 1;
    return {outcome: {outcome: "selected" as const, optionId: "once"}};
  };
  assert.deepEqual(await requestTeamAcpPermission(() => mode, {options}, ask), {
    outcome: {outcome: "selected", optionId: "once"},
  });
  mode = "off";
  assert.deepEqual(await requestTeamAcpPermission(() => mode, {options}, ask), {
    outcome: {outcome: "selected", optionId: "reject"},
  });
  assert.equal(prompts, 0);
});

test("blocking a device while its ACP permission dialog is open rejects the stale approval", async () => {
  let mode: DeviceAccessMode = "ask";
  const response = await requestTeamAcpPermission(() => mode, {options}, async () => {
    mode = "off";
    return {outcome: {outcome: "selected", optionId: "once"}};
  });
  assert.deepEqual(response, {outcome: {outcome: "selected", optionId: "reject"}});
});
