import assert from "node:assert/strict";
import test from "node:test";
import {parseWeChatLogin, weChatLoginHidden} from "../src/wechat-login.js";

const qr = "data:image/png;base64,iVBORw0KGgoAAA==";
const response = {ok: true, state: "interactive_login", optionsReady: true, qrDataUrl: qr};

test("only a current login QR with verified options receives a short display lifetime", () => {
  assert.deepEqual(parseWeChatLogin(response, 100), {
    state: "interactive_login", optionsReady: true, qrDataUrl: qr, expiresAt: 10_100,
  });
  for (const patch of [{state: "signed_in"}, {optionsReady: false}, {issue: "qr-expired"}, {qrDataUrl: "https://example.com/qr"},
    {qrDataUrl: "data:image/svg+xml,<svg/>"}, {ok: false}])
    assert.equal(parseWeChatLogin({...response, ...patch}, 100).qrDataUrl, null);
});

test("changed process identity discards even a successful capture", async () => {
  let reads = 0;
  const result = await weChatLoginHidden({helperPath: "helper", processId: async () => 42,
    run: async (file, args) => {
      if (file === "helper") {
        assert.deepEqual(args, ["--login-snapshot", "--pid", "42"]);
        return {stdout: JSON.stringify(response), stderr: ""};
      }
      return {stdout: ++reads === 1 ? "original birth" : "replacement birth", stderr: ""};
    }});
  assert.equal(result.qrDataUrl, null);
  assert.equal(result.state, "unavailable");
});

test("failed or unavailable captures never retain an earlier QR", async () => {
  let calls = 0;
  const result = await weChatLoginHidden({helperPath: "helper", processId: async () => null,
    run: async () => { calls += 1; throw new Error("must not launch"); }});
  assert.equal(calls, 0);
  assert.equal(result.qrDataUrl, null);
  const denied = parseWeChatLogin({ok: true, state: "interactive_login", issue: "screen-recording", optionsReady: true}, 100);
  assert.equal(denied.issue, "screen-recording");
  assert.equal(denied.qrDataUrl, null);
});


test("an unavailable background guard remains actionable for remembered and QR login", () => {
  for (const state of ["remembered_login", "interactive_login"])
    assert.deepEqual(parseWeChatLogin({ok: true, state, optionsReady: false,
      issue: "background-guard", qrDataUrl: qr}, 100), {
      state, optionsReady: false, issue: "background-guard", qrDataUrl: null, expiresAt: null,
    });
});
