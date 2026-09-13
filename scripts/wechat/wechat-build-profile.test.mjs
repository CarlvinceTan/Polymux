import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {promisify} from "node:util";

const run = promisify(execFile);
const modulePath = fileURLToPath(new URL("./wechat_native_task_lldb.py", import.meta.url));

/** The offsets the session list walker and the group rename wrapper need. They
 * are separate private Qt entry points from the composer ones, so a build that
 * has not had them derived must refuse rather than reuse another build's. */
const offsets = [
  ["session_list_call", "SESSION_LIST_CALL_OFFSET"],
  ["session_list_model_offset", "SESSION_LIST_MODEL_OFFSET"],
  ["session_list_argument_offset", "SESSION_LIST_ARGUMENT_OFFSET"],
  ["session_cell_static_metacall", "SESSION_CELL_STATIC_METACALL_OFFSET"],
  ["session_cell_recipient_offset", "SESSION_CELL_RECIPIENT_OFFSET"],
  ["rename_group_call", "RENAME_GROUP_CALL_OFFSET"],
];
const oldBuild = "C6F8C0A6-BB7C-3DF1-B3AC-CAD6A1A1461F";
const newBuild = "CDB81058-0FAC-3518-95F5-C0CC7860F9B5";

const program = `
import importlib.util, json, sys, types
sys.modules.setdefault("lldb", types.ModuleType("lldb"))
spec = importlib.util.spec_from_file_location("wechat_native_task_lldb", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
names = json.loads(sys.argv[2])
profiles = module._WECHAT_BUILD_PROFILES


class FakeModule:
    def __init__(self, identifier):
        self._identifier = identifier

    def GetUUIDString(self):
        return self._identifier


def values():
    return {name: getattr(module, name) for name in names}


report = {
    "old": {key: profiles[sys.argv[3]].get(key) for key, _ in json.loads(sys.argv[5])},
    "new": {key: profiles[sys.argv[4]].get(key) for key, _ in json.loads(sys.argv[5])},
    "defaults": values(),
}
module._select_wechat_build(FakeModule(sys.argv[4].lower()))
report["selected_new"] = values()
try:
    module._require_offsets(module._SESSION_LIST_OFFSETS)
    report["refused"] = None
except Exception as error:
    report["refused"] = str(error)
module._select_wechat_build(FakeModule(sys.argv[3]))
report["selected_old"] = module._require_offsets(module._SESSION_LIST_OFFSETS)
print(json.dumps(report))
`;

async function profileReport() {
  const {stdout} = await run("python3", [
    "-c", program, modulePath, JSON.stringify(offsets.map(([, name]) => name)),
    oldBuild, newBuild, JSON.stringify(offsets),
  ]);
  return JSON.parse(stdout);
}

test("only the profiled build records the session and rename offsets", async () => {
  const report = await profileReport();
  for (const [key] of offsets) assert.equal(typeof report.old[key], "number", key);
  for (const [key] of offsets) assert.equal(report.new[key], null, key);
});

test("an unprofiled session route fails closed instead of reusing 4.1.11", async () => {
  const report = await profileReport();
  assert.match(report.refused ?? "", /no derived/);
  assert.match(report.refused ?? "", /SESSION_LIST_CALL_OFFSET/);
  for (const [, name] of offsets) assert.equal(report.selected_new[name], null, name);
});

test("selecting the profiled build restores the session list offsets", async () => {
  const report = await profileReport();
  const expected = ["session_list_call", "session_list_model_offset", "session_list_argument_offset"]
    .map((key) => report.old[key]);
  assert.deepEqual(report.selected_old, expected);
});
