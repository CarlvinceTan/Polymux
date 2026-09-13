import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const registry = fileURLToPath(new URL('./app-control-registry.py', import.meta.url));

// Execute the real parser and audit gate with synthetic LaunchServices output.
// No running app, registry grants, or macOS commands are accessed by these tests.
function resolveFixture(fixture) {
  const result = execFileSync('python3', ['-c', String.raw`
import argparse, contextlib, importlib.util, io, json, pathlib, subprocess, sys, tempfile
spec = importlib.util.spec_from_file_location("registry", sys.argv[1])
registry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registry)
fixture = json.load(sys.stdin)
queries = []
def run(args, **kwargs):
    if args[1] == "find":
        return subprocess.CompletedProcess(args, fixture.get("findCode", 0), fixture["find"], "")
    assert args[:4] == ["/usr/bin/lsappinfo", "info", "-only", "pid"]
    queries.append(args[4])
    value = fixture.get("info", {}).get(args[4], {})
    return subprocess.CompletedProcess(args, value.get("code", 0), value.get("stdout", ""), "")
registry.subprocess.run = run
pids = sorted(registry.running_bundle_pids("com.example.fixture"))
result = {"pids": pids, "queries": queries.copy()}
if "auditPid" in fixture:
    with tempfile.TemporaryDirectory() as directory:
        app = pathlib.Path(directory) / "Fixture.app"
        app.mkdir()
        registry.app_identity = lambda path: {"bundle_id": fixture.get("bundleId", "com.example.fixture"), "executable": "Fixture", "version": "1", "app_build": "1"}
        registry.sw_vers = lambda option: "fixture"
        registry.frontmost_pid = lambda: fixture.get("frontmostPid", 999)
        args = argparse.Namespace(app_path=str(app), bundle_id="com.example.fixture", pid=fixture["auditPid"], require_nonfrontmost=True)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result["auditCode"] = registry.verify_audit_identity(args)
        result["auditOutput"] = output.getvalue()
print(json.dumps(result))
`, registry], {input: JSON.stringify(fixture), encoding: 'utf8'});
  return JSON.parse(result);
}

const first = 'ASN:0x0-0x111';
const second = 'ASN:0x0-0x222';
const info = {[first]: {stdout: '"pid"=100\n'}, [second]: {stdout: '"pid"=101\n'}};

test('resolves each same-line ASN independently, including quoted display names', () => {
  const result = resolveFixture({find: `${first}-"Fixture App": ${second}-"Fixture App":\n`, info, auditPid: 101});
  assert.deepEqual(result.pids, [100, 101]);
  assert.deepEqual(result.queries, [first, second]);
  assert.equal(result.auditCode, 0);
  assert.match(result.auditOutput, /status=verified_audit_identity/);
});

test('supports multiline and bare ASN output without querying duplicate records', () => {
  const result = resolveFixture({find: `${first}-"Fixture":\n\t${second}\n${first}\n`, info});
  assert.deepEqual(result.pids, [100, 101]);
  assert.deepEqual(result.queries, [first, second]);
});

test('rejects malformed ASNs, failed commands and invalid PID output', () => {
  assert.deepEqual(resolveFixture({find: `prefix${first} ${first}suffix ASN:0x0-nothex`, info}).queries, []);
  assert.deepEqual(resolveFixture({find: first, findCode: 1, info}).pids, []);
  for (const output of ['"pid"=0', '"pid"=-5', '"pid"=100\n"pid"=101', 'pid=100', '"pid"=100 trailing']) {
    assert.deepEqual(resolveFixture({find: first, info: {[first]: {stdout: output}}}).pids, []);
  }
  assert.deepEqual(resolveFixture({find: `${first} ${second}`, info: {...info, [first]: {stdout: '"pid"=100', code: 1}}}).pids, [101]);
});

test('audit still denies wrong PID, wrong bundle, focused target and unknown focus', () => {
  const fixture = {find: `${first} ${second}`, info};
  assert.equal(resolveFixture({...fixture, auditPid: 102}).auditCode, 4);
  assert.equal(resolveFixture({...fixture, auditPid: 101, bundleId: 'com.example.other'}).auditCode, 3);
  assert.equal(resolveFixture({...fixture, auditPid: 101, frontmostPid: 101}).auditCode, 5);
  assert.equal(resolveFixture({...fixture, auditPid: 101, frontmostPid: null}).auditCode, 5);
});
