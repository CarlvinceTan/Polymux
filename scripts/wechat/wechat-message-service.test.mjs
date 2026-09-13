import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {randomUUID} from 'node:crypto';
import {chmod, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {sendNativeServiceText} from './wechat-wire.mjs';

const run = promisify(execFile);

test('service text rejects invalid identities and malformed text before native access', async () => {
  const valid = {recipient:'filehelper',userId:'wxid_fixture',text:'hello'};
  for (const change of [{recipient:''},{recipient:'../other'}, {userId:'x\0y'},
    {text:''},{text:'x\0y'},{text:'\ud800'},{text:'a'.repeat(65537)}])
    await assert.rejects(sendNativeServiceText({...valid,...change}), /invalid/);
});

test('native request reader rejects links, shared files, missing fields and stale requests without loading WeChat',
  {skip:process.platform !== 'darwin'}, async () => {
    const directory = await mkdtemp(path.join(tmpdir(),'polymux-service-contract-'));
    const nonce = randomUUID();
    const arm = `/tmp/polymux-wechat-service-arm-${nonce}.json`;
    const status = `/tmp/polymux-wechat-service-status-${nonce}.json`;
    try {
      const native = fileURLToPath(new URL('../../packages/wechat/src/native/wechat-message-service.mm',import.meta.url));
      const script = path.join(directory,'contract.mm'), binary = path.join(directory,'contract');
      await writeFile(script, `
#import ${JSON.stringify(native)}
#include <cassert>
int main(int argc, const char **argv) {
  @autoreleasepool {
    assert(argc == 3);
    NSString *arm = [NSString stringWithUTF8String:argv[1]];
    NSString *mode = [NSString stringWithUTF8String:argv[2]];
    if ([mode isEqualToString:@"resident"]) {
      assert(startListener());
      assert(startListener());
      NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:20];
      while (deadline.timeIntervalSinceNow>0 && ![NSFileManager.defaultManager fileExistsAtPath:@${JSON.stringify(status)}])
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    } else if ([mode isEqualToString:@"read"]) {
      try { requiredString(requestAt(arm), @"text", 64); puts("accepted"); }
      catch (const std::exception &error) { puts(error.what()); }
    } else if ([mode isEqualToString:@"expired"]) {
      NSDictionary *packet = @{@"createdAt":@0, @"pid":@(getpid())};
      NSData *data = [NSJSONSerialization dataWithJSONObject:packet options:0 error:nil];
      [data writeToFile:arm atomically:NO];
      chmod(arm.fileSystemRepresentation,0600);
      sendText(@${JSON.stringify(status)},arm);
    } else {
      assert(!privatePath(@"/tmp/other.json",@"polymux-wechat-service-arm-"));
      assert(!privatePath(@"/var/tmp/polymux-wechat-service-arm-test.json",@"polymux-wechat-service-arm-"));
      assert(requiredString(@{@"text":@"中文 🙂"},@"text",64)=="中文 🙂");
      bool rejected=false; try { imageBase(); } catch(const std::exception&) { rejected=true; }
      assert(rejected);
      assert(polymux_send_wechat_service_text("/tmp/unrelated.json","/tmp/unrelated.json")==-1);
      puts("contract passed");
    }
  }
}
`);
      const revision='f'.repeat(64);
      await run('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-Wall','-Wextra','-Werror',`-DPOLYMUX_NATIVE_HELPER_REVISION="${revision}"`,'-framework','Foundation','-framework','CoreGraphics',script,'-o',binary],{timeout:60_000});
      assert.match((await run(binary,[arm,'contract'])).stdout,/contract passed/);
      await writeFile(arm,JSON.stringify({text:'中文 🙂'}),{mode:0o600});
      assert.match((await run(binary,[arm,'read'])).stdout,/accepted/);
      await chmod(arm,0o640);
      assert.match((await run(binary,[arm,'read'])).stdout,/request_invalid/);
      await chmod(arm,0o600);
      await writeFile(arm,'{}');
      assert.match((await run(binary,[arm,'read'])).stdout,/request_invalid/);
      await rm(arm);
      const target = path.join(directory,'target.json');
      await writeFile(target,JSON.stringify({text:'private'}),{mode:0o600});
      await symlink(target,arm);
      assert.match((await run(binary,[arm,'read'])).stdout,/request_unavailable/);
      await rm(arm);
      await run(binary,[arm,'expired']);
      assert.deepEqual(JSON.parse(await readFile(status,'utf8')), {
        ok:false,submitted:false,verificationPending:false,reason:'wechat_native_request_expired',
      });
      await rm(status);
      const child=spawn(binary,[arm,'resident'],{stdio:['ignore','pipe','pipe']});
      const exited=new Promise(resolve=>child.once('close',resolve));
      const socketPath=`/tmp/pmx-wx-service-${process.getuid()}-${child.pid}-${revision.slice(0,16)}.sock`;
      try {
        await writeFile(arm,JSON.stringify({createdAt:Date.now()/1000,pid:child.pid,
          requestId:'fixture',accountId:'wxid_fixture',recipient:'filehelper',text:'never submitted'}),{mode:0o600});
        // Deliver the packet while the listener comes up. The listener writes
        // the status file only after it has read a complete request, so that
        // file is the proof the rejection contract ran; a transport race must
        // not be mistaken for a contract failure.
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && !existsSync(status)) {
          if (existsSync(socketPath)) {
            await new Promise(resolve => {
              const socket = createConnection(socketPath);
              socket.once('error', () => resolve());
              socket.once('connect', () => socket.end(JSON.stringify({statusPath:status,requestPath:arm})+'\n'));
              socket.once('close', () => resolve());
            });
          }
          if (!existsSync(status)) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(existsSync(status), true, 'the native listener never wrote its status file');
        assert.equal(await exited, 0);
        assert.deepEqual(JSON.parse(await readFile(status,'utf8')),{
          ok:false,submitted:false,verificationPending:false,reason:'wechat_native_build_unsupported',
        });
      }finally {child.kill('SIGTERM');await exited;await rm(socketPath,{force:true});}
    } finally {
      await Promise.all([rm(directory,{recursive:true,force:true}),rm(arm,{force:true}),rm(status,{force:true})]);
    }
  });

test('service scheduler separates preflight refusal from an uncertain evaluated send', async () => {
  const source = fileURLToPath(new URL('./wechat_native_task_lldb.py', import.meta.url));
  const fixture = `
import ast, json, types, sys
source = open(sys.argv[1]).read()
function = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == 'schedule_service_text')
class Result:
 def AppendMessage(self, text): self.value = json.loads(text)
process = types.SimpleNamespace(IsValid=lambda: True, GetState=lambda: 1,
 threads=[types.SimpleNamespace(GetQueueName=lambda: 'com.apple.main-thread', GetFrameAtIndex=lambda _: object())])
target = types.SimpleNamespace(GetProcess=lambda: process)
debugger = types.SimpleNamespace(GetSelectedTarget=lambda: target)
for mode in ['preflight', 'evaluation-timeout', 'rejected', 'scheduled']:
 calls = []
 def module_base(_):
  if mode == 'preflight': raise RuntimeError('unsupported build')
 def evaluate(*args, **kwargs):
  calls.append('evaluate')
  if mode == 'evaluation-timeout': raise RuntimeError('expression timed out after queueing')
  return -1 if mode == 'rejected' else 1
 scope = {'os': types.SimpleNamespace(environ={}, path=types.SimpleNamespace(isfile=lambda _: True)),
  'json': json, 'lldb': types.SimpleNamespace(eStateStopped=1), '_module_base': module_base,
  '_evaluate_objc': evaluate, 'MODEL_STATUS_PATH': '/fixture/status', 'MODEL_ARM_PATH': '/fixture/arm'}
 exec(compile(ast.Module(body=[function], type_ignores=[]), '<fixture-scheduler>', 'exec'), scope)
 result = Result()
 scope['schedule_service_text'](debugger, '', result, {})
 if mode == 'scheduled': assert result.value['scheduled'] is True
 else:
  assert result.value['scheduled'] is False
  assert (result.value.get('deliveryUnconfirmed') is True) == (mode == 'evaluation-timeout'), result.value
 assert bool(calls) == (mode != 'preflight')
print('scheduler uncertainty contract passed')
`;
  assert.match((await run('python3', ['-c', fixture, source], {timeout: 10_000})).stdout,
    /scheduler uncertainty contract passed/);
});
