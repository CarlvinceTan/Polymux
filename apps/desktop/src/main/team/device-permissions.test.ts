import assert from "node:assert/strict";
import test from "node:test";
import {authorizeDeviceRequest, type DeviceRequestAccess} from "./device-permissions.js";

test("remote allowed access executes without presenting approval as a user-granted lease", async () => {
  assert.deepEqual(await authorizeDeviceRequest(async () => ({allowed: true, requiresApproval: false}), async () => {
    assert.fail("Allowed devices do not prompt");
  }), {approved: true, approvedByUser: false});
});

test("remote denied access refuses before asking", async () => {
  assert.deepEqual(await authorizeDeviceRequest(async () => ({allowed: false, requiresApproval: true}), async () => {
    assert.fail("Blocked devices do not prompt");
  }), {approved: false, approvedByUser: false});
});

test("remote device restrictions override approval while a dialog is open", async () => {
  let mode: DeviceRequestAccess = {allowed: true, requiresApproval: true};
  assert.deepEqual(await authorizeDeviceRequest(async () => mode, async () => {
    mode = {allowed: false, requiresApproval: true};
    return true;
  }), {approved: false, approvedByUser: false});
});

test("remote asked access records only explicit current user approval", async () => {
  assert.deepEqual(await authorizeDeviceRequest(async () => ({allowed: true, requiresApproval: true}), async () => true), {
    approved: true, approvedByUser: true,
  });
  assert.deepEqual(await authorizeDeviceRequest(async () => ({allowed: true, requiresApproval: true}), async () => false), {
    approved: false, approvedByUser: false,
  });
});
