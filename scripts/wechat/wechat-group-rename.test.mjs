import assert from "node:assert/strict";
import test from "node:test";
import {renameDesktopGroup, validateGroupRename} from "./wechat-group-rename.mjs";

const request = {chatId: "123456@chatroom", name: "学习小组 🐷", expectedName: "Study group"};

function fixture(reads, overrides = {}) {
  let time = 0, isolated = false;
  const sent = [];
  const original = {chatId: request.chatId, name: request.expectedName, isMember: true};
  return {sent, options: {
    read: async () => ({...original, ...(reads.length > 1 ? reads.shift() : reads[0])}),
    submit: async (...args) => {assert.equal(isolated, true); sent.push(args);},
    isolate: async action => {isolated = true; try {return await action();} finally {isolated = false;}},
    sleep: async ms => {time += ms;}, now: () => time, timeoutMs: 1200,
    ...overrides,
  }};
}

test("a rename waits for stable native confirmation, preserving Unicode", async () => {
  const {options, sent} = fixture([{}, {}, {name: request.name}, {name: request.name}]);
  assert.deepEqual(await renameDesktopGroup(request, options), {deliveredVerified: true});
  assert.deepEqual(sent, [[request.chatId, request.name]]);
});

test("stale forms, wrong group state and departed membership cannot dispatch", async () => {
  for (const current of [{name: "Someone else's rename"}, {isMember: false}, {chatId: "999@chatroom"}]) {
    const {options, sent} = fixture([current]);
    await assert.rejects(renameDesktopGroup(request, options), /changed|member/);
    assert.equal(sent.length, 0);
  }
});

test("a previous rename that eventually completed is an idempotent read", async () => {
  const {options, sent} = fixture([{name: request.name}]);
  assert.deepEqual(await renameDesktopGroup(request, options), {deliveredVerified: true});
  assert.equal(sent.length, 0);
});

test("a dispatch alone or a rolled-back native name is not verification and is never replayed", async () => {
  for (const states of [[{}], [{}, {name: request.name}, {}]]) {
    const {options, sent} = fixture(states);
    const result = await renameDesktopGroup(request, options);
    assert.equal(result.deliveredVerified, false);
    assert.match(result.reason, /Reload/);
    assert.equal(sent.length, 1);
  }
});

test("malformed names and non-group recipients fail before isolation", async () => {
  for (const invalid of [{chatId: "filehelper"}, {chatId: "../x@chatroom"}, {name: " "},
    {name: "line\nbreak"}, {name: "abc\0def"}, {name: "\ud800"}, {name: "x".repeat(1025)},
    {expectedName: null}, {name: " padded "}]) {
    assert.throws(() => validateGroupRename({...request, ...invalid}));
    await assert.rejects(renameDesktopGroup({...request, ...invalid}, {
      isolate: () => assert.fail("invalid request acquired native access"),
    }));
  }
});
