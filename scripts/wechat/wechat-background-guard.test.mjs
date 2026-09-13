import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {chmod, link, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
const run = promisify(execFile);
const native = fileURLToPath(new URL('../../packages/wechat/src/native/', import.meta.url));
const revision = 'e'.repeat(64);
/** The injected guard writes into NSTemporaryDirectory(), which for an
 * unsandboxed fixture process is the same per-user directory the test sees. */
const guardProofPath = (pid) => path.join(tmpdir(), `polymux-wechat-window-guard-${pid}.background`);

test('persistent guard intercepts front, key, activation and opacity requests before their originals', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-contract-'));
  try {
    const source=path.join(dir,'fixture.m'),binary=path.join(dir,'fixture');
    await writeFile(source, `
#import ${JSON.stringify(path.join(native,'wechat-prime-inject.m'))}
#include <assert.h>
@interface FakeWindow : NSObject
@property CGFloat alphaValue;
@property BOOL ignoresMouseEvents;
@property NSRect frame;
@property NSInteger level;
- (void)setFrame:(NSRect)rect display:(BOOL)display;
@end
@implementation FakeWindow
- (void)setFrame:(NSRect)rect display:(BOOL)display { self.frame=rect; }
@end
@interface FakeApplication : NSObject
@property pid_t processIdentifier;
@end
@implementation FakeApplication
@end
static FakeApplication *foreground;
static id observedForeground(id object, SEL selector) { return foreground; }
static int frontCalls=0, backCalls=0, keyCalls=0, activations=0;
static NSInteger lastLevel=99;
static CGFloat lastAlpha=99;
static void front(id object, SEL selector, ...) { frontCalls++; }
static void key(id object, SEL selector) { keyCalls++; }
static BOOL activate(id object, SEL selector, ...) { activations++; return YES; }
static void order(id object, SEL selector, NSWindowOrderingMode mode, NSInteger relative) {
  assert(mode==NSWindowBelow && relative==0); backCalls++;
}
static void level(id object, SEL selector, NSInteger value) { lastLevel=value; }
static void alpha(id object, SEL selector, CGFloat value) { lastAlpha=value; }
int main() { @autoreleasepool {
  PMXMethodOverride untouched={NULL,NULL};
  Method original=class_getInstanceMethod(NSWindow.class,@selector(setLevel:));
  IMP before=method_getImplementation(original);
  PMXMethodBinding incomplete[] = {
    {NSWindow.class,@selector(setLevel:),(IMP)level,&untouched,NO},
    {NSWindow.class,NSSelectorFromString(@"missingRequiredGuardSelector"),(IMP)level,&untouched,NO},
  };
  assert(!PMXApplyMethodBindings(incomplete,2));
  assert(!PMXApplyMethodBindings(incomplete,2));
  assert(method_getImplementation(original)==before && !untouched.method);
  foreground=[FakeApplication new]; foreground.processIdentifier=getpid()+100;
  method_setImplementation(class_getInstanceMethod(NSWorkspace.class,@selector(frontmostApplication)),(IMP)observedForeground);
  PMXBackgroundProtected=YES; PMXBeforeApplicationMain=YES;
  assert(PMXInstallGuard()); assert(PMXGuardMethodsIntact());
  // Originals are spies: this test never initializes NSApplication, creates a
  // real window or requests actual foreground activation.
  PMXOrderFront.implementation=(IMP)front;
  PMXOrderFrontRegardless.implementation=(IMP)front;
  PMXMakeKeyAndOrderFront.implementation=(IMP)front;
  PMXOrderWindow.implementation=(IMP)order;
  PMXMakeKey.implementation=(IMP)key; PMXBecomeKey.implementation=(IMP)key;
  PMXActivate.implementation=(IMP)activate; PMXActivateIgnoring.implementation=(IMP)activate;
  PMXRunningActivate.implementation=(IMP)activate; PMXRunningActivateFrom.implementation=(IMP)activate;
  PMXSetLevel.implementation=(IMP)level; PMXSetAlpha.implementation=(IMP)alpha;
  FakeWindow *window=[FakeWindow new]; window.alphaValue=0.8; window.frame=NSMakeRect(30,40,300,300); window.level=NSFloatingWindowLevel;
  PMXGuardedOrderFront(window,@selector(orderFront:),nil);
  PMXGuardedOrderFrontRegardless(window,@selector(orderFrontRegardless));
  PMXGuardedMakeKeyAndOrderFront(window,@selector(makeKeyAndOrderFront:),nil);
  PMXGuardedOrderWindow(window,@selector(orderWindow:relativeTo:),NSWindowAbove,0);
  PMXGuardedMakeKey(window,@selector(makeKeyWindow)); PMXGuardedBecomeKey(window,@selector(becomeKeyWindow));
  PMXGuardedSetLevel(window,@selector(setLevel:),NSFloatingWindowLevel);
  PMXGuardedSetAlpha(window,@selector(setAlphaValue:),1);
  FakeApplication *app=[FakeApplication new]; app.processIdentifier=getpid();
  PMXGuardedActivate(app,NSSelectorFromString(@"activate"));
  PMXGuardedActivateIgnoring(app,NSSelectorFromString(@"activateIgnoringOtherApps:"),YES);
  assert(!PMXGuardedRunningActivate(app,NSSelectorFromString(@"activateWithOptions:"),3));
  assert(!PMXGuardedRunningActivateFrom(app,NSSelectorFromString(@"activateFromApplication:options:"),nil,3));
  assert(frontCalls==0 && keyCalls==0 && activations==0 && backCalls==4);
  assert(lastLevel==NSNormalWindowLevel && lastAlpha<=0.001);
  PMXGuardDeadline=[NSDate dateWithTimeIntervalSinceNow:-60]; PMXStartupFinished=YES;
  assert(PMXColdGuardActive()); // No delayed expiry which can expose login.
  app.processIdentifier=getpid()+100;
  assert(PMXGuardedRunningActivate(app,NSSelectorFromString(@"activateWithOptions:"),0));
  assert(activations==1); // Never blocks the user's other applications.
  PMXBeforeApplicationMain=NO; PMXObserveRealActivation();
  [[NSNotificationCenter defaultCenter] postNotificationName:NSApplicationDidBecomeActiveNotification object:nil];
  assert(window.alphaValue<=0.001); // A synthetic notification cannot reveal it.
  foreground.processIdentifier=getpid();
  [[NSNotificationCenter defaultCenter] postNotificationName:NSApplicationDidBecomeActiveNotification object:nil];
  assert(NSEqualRects(window.frame,NSMakeRect(30,40,300,300)));
  assert(window.alphaValue==0.8 && !window.ignoresMouseEvents && window.level==NSFloatingWindowLevel);
  PMXGuardedOrderFront(window,@selector(orderFront:),nil);
  PMXGuardedMakeKey(window,@selector(makeKeyWindow));
  assert(frontCalls==1 && keyCalls==1);
  foreground.processIdentifier=getpid()+100;
  PMXGuardedOrderFront(window,@selector(orderFront:),nil);
  PMXGuardedMakeKey(window,@selector(makeKeyWindow));
  assert(frontCalls==1 && keyCalls==1 && backCalls==5 && window.alphaValue<=0.001);
  foreground.processIdentifier=getpid();
  [[NSNotificationCenter defaultCenter] postNotificationName:NSApplicationDidBecomeActiveNotification object:nil];
  assert(NSEqualRects(window.frame,NSMakeRect(30,40,300,300)) && window.alphaValue==0.8);
  assert(PMXBackgroundProof()[@"version"] && PMXGuardMethodsIntact());
  method_setImplementation(PMXMakeKey.method,(IMP)key);
  assert(!PMXGuardMethodsIntact() && !PMXBackgroundProof());
  puts("guard interception passed");
} }
`);
    await run('/usr/bin/clang',['-fobjc-arc','-framework','AppKit',`-DPOLYMUX_NATIVE_HELPER_REVISION="${revision}"`,source,'-o',binary],{timeout:60000});
    assert.match((await run(binary,[],{timeout:10000})).stdout,/guard interception passed/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('inserted guard is active before dependent library initializers and main, without launching WeChat', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-premain-contract-'));
  let fixturePid;
  try {
    const guard=path.join(dir,'guard.dylib'),dep=path.join(dir,'dependency.dylib'),binary=path.join(dir,'fixture');
    await run('/usr/bin/clang',['-fobjc-arc','-dynamiclib','-framework','AppKit',`-DPOLYMUX_NATIVE_HELPER_REVISION="${revision}"`,path.join(native,'wechat-prime-inject.m'),'-o',guard],{timeout:60000});
    await writeFile(path.join(dir,'dependency.c'), `
#include <dlfcn.h>
#include <stdlib.h>
__attribute__((constructor)) static void before_main(void) {
  int (*active)(void)=dlsym(RTLD_DEFAULT,"polymux_wechat_background_guard_active");
  if(!active || active()!=1) _Exit(77);
}
int dependency(void) {return 1;}
`);
    await writeFile(path.join(dir,'main.c'), '#include <stdio.h>\n#include <unistd.h>\nextern int dependency(void);\nint main(void) { printf("%d %d\\n",getpid(),dependency()); return 0; }\n');
    await run('/usr/bin/clang',['-dynamiclib',path.join(dir,'dependency.c'),'-o',dep],{timeout:60000});
    await run('/usr/bin/clang',[path.join(dir,'main.c'),dep,'-o',binary],{timeout:60000});
    // The negative control exits in its initializer. It has no GUI code.
    await assert.rejects(run(binary,[],{timeout:10000}),e=>e.code===77);
    const result=await run(binary,[],{timeout:10000,env:{...process.env,DYLD_INSERT_LIBRARIES:guard,POLYMUX_WECHAT_PRIME_ON_LAUNCH:'2'}});
    const [pid,value]=result.stdout.trim().split(' ').map(Number); fixturePid=pid;
    assert.equal(value,1);assert.ok(pid>1);
    const proof=JSON.parse(await readFile(guardProofPath(pid),'utf8'));
    assert.equal(proof.pid,pid);assert.equal(proof.revision,revision);assert.equal(proof.version,2);
  } finally {
    if(fixturePid)await rm(guardProofPath(fixturePid),{force:true});
    await rm(dir,{recursive:true,force:true});
  }
});

test('login admission rejects stale, foreign, writable, linked and replaced guard proofs', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-proof-'));
  try {
    const common=await readFile(path.join(native,'wechat-background-safety.swift'),'utf8');
    const script=path.join(dir,'main.swift'),binary=path.join(dir,'fixture');
    await writeFile(path.join(dir,'VERSION'),revision);
    await writeFile(script,common+`
let pid=getpid(), file=URL(fileURLWithPath:NSTemporaryDirectory(),isDirectory:true).appendingPathComponent("polymux-wechat-window-guard-\\(getpid()).background").path
defer {try? FileManager.default.removeItem(atPath:file)}
var birth=proc_bsdinfo()
precondition(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&birth,Int32(MemoryLayout.size(ofValue:birth)))>0)
var proof:[String:Any] = ["version":2,"pid":pid,"birthSeconds":birth.pbi_start_tvsec,"birthMicros":birth.pbi_start_tvusec,"revision":"${revision}","checkedAt":Date().timeIntervalSince1970]
let mode=CommandLine.arguments[1]
if mode=="stale" {proof["checkedAt"]=Date().timeIntervalSince1970-2}
if mode=="future" {proof["checkedAt"]=Date().timeIntervalSince1970+5}
if mode=="pid" {proof["pid"]=pid+1}
if mode=="birth" {proof["birthMicros"]=birth.pbi_start_tvusec+1}
if mode=="version" {proof["version"]=1}
if mode=="revision" {proof["revision"]="old"}
try JSONSerialization.data(withJSONObject:proof).write(to:URL(fileURLWithPath:file))
chmod(file,mode=="permissions" ? 0o644:0o600)
if mode=="symlink" || mode=="hardlink" {
 let target=file+".target"
 try FileManager.default.moveItem(atPath:file,toPath:target)
 defer {try? FileManager.default.removeItem(atPath:target)}
 if mode=="symlink" {symlink(target,file)} else {link(target,file)}
 print(verifiedBackgroundGuard(pid,requireBackground:false))
} else {print(verifiedBackgroundGuard(pid,requireBackground:false))}
`);
    await run('/usr/bin/swiftc',['-O',script,'-o',binary],{timeout:60000});
    assert.equal((await run(binary,['valid'])).stdout.trim(),'true');
    for(const mode of ['stale','future','pid','birth','version','revision','permissions','symlink','hardlink'])
      assert.equal((await run(binary,[mode])).stdout.trim(),'false',mode);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('another resident guard revision cannot replace hooks or its proof owner', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-revisions-'));
  let fixturePid;
  try {
    const source=path.join(dir,'guard.m');
    await writeFile(source, `
#import ${JSON.stringify(path.join(native,'wechat-prime-inject.m'))}
int fixture_install(void) { PMXBackgroundProtected=YES; PMXBeforeApplicationMain=YES; return PMXInstallGuard(); }
void fixture_publish(void) { PMXPublishBackgroundProof(); }
`);
    const images=[];
    for (const letter of ['a','b']) {
      const output=path.join(dir,`libpolymux-wechat-prime-${letter.repeat(64)}.dylib`);
      await run('/usr/bin/clang',['-fobjc-arc','-dynamiclib','-framework','AppKit',`-DPOLYMUX_NATIVE_HELPER_REVISION="${letter.repeat(64)}"`,source,'-o',output],{timeout:60000});
      images.push(output);
    }
    const main=path.join(dir,'main.c'),binary=path.join(dir,'fixture');
    await writeFile(main, `
#include <assert.h>
#include <dlfcn.h>
#include <stdio.h>
#include <unistd.h>
int main(int argc,char **argv) {
 void *a=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL),*b=dlopen(argv[2],RTLD_NOW|RTLD_LOCAL);
 assert(a && b);
 int(*installA)(void)=dlsym(a,"fixture_install"),(*installB)(void)=dlsym(b,"fixture_install");
 void(*publishA)(void)=dlsym(a,"fixture_publish"),(*publishB)(void)=dlsym(b,"fixture_publish");
 assert(installA()==1); publishA();
 assert(installB()==0); publishB();
 assert(installA()==1); publishA();
 assert(installB()==0); publishB();
 printf("%d\\n",getpid());
}
`);
    await run('/usr/bin/clang',[main,'-o',binary],{timeout:60000});
    fixturePid=Number((await run(binary,images,{timeout:10000})).stdout.trim());
    assert.ok(fixturePid>1);
    const proof=JSON.parse(await readFile(guardProofPath(fixturePid),'utf8'));
    assert.equal(proof.revision,'a'.repeat(64));
  } finally {
    if(fixturePid)await rm(guardProofPath(fixturePid),{force:true});
    await rm(dir,{recursive:true,force:true});
  }
});

test('dependent Objective-C load methods also observe the pre-main guard', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-objc-load-'));
  let fixturePid;
  try {
    const guard=path.join(dir,'guard.dylib'),dep=path.join(dir,'dependency.dylib'),binary=path.join(dir,'fixture');
    await run('/usr/bin/clang',['-fobjc-arc','-dynamiclib','-framework','AppKit',`-DPOLYMUX_NATIVE_HELPER_REVISION="${revision}"`,path.join(native,'wechat-prime-inject.m'),'-o',guard],{timeout:60000});
    await writeFile(path.join(dir,'dep.m'), `
#import <Foundation/Foundation.h>
#import <dlfcn.h>
@interface LoadCheck:NSObject @end
@implementation LoadCheck
+(void)load {int(*active)(void)=dlsym(RTLD_DEFAULT,"polymux_wechat_background_guard_active"); if(!active || active()!=1) _Exit(77);}
@end
int dependency(void) {return 1;}
`);
    await writeFile(path.join(dir,'main.c'),'#include <stdio.h>\n#include <unistd.h>\nextern int dependency(void);\nint main(void) {printf("%d\\n",getpid()); return dependency()!=1;}\n');
    await run('/usr/bin/clang',['-dynamiclib','-framework','Foundation',path.join(dir,'dep.m'),'-o',dep],{timeout:60000});
    await run('/usr/bin/clang',[path.join(dir,'main.c'),dep,'-o',binary],{timeout:60000});
    await assert.rejects(run(binary,[],{timeout:10000}),e=>e.code===77);
    fixturePid=Number((await run(binary,[],{timeout:10000,env:{...process.env,DYLD_INSERT_LIBRARIES:guard,POLYMUX_WECHAT_PRIME_ON_LAUNCH:'2'}})).stdout.trim());
    assert.ok(fixturePid>1);
  } finally {
    if(fixturePid)await rm(guardProofPath(fixturePid),{force:true});
    await rm(dir,{recursive:true,force:true});
  }
});

test('login requires positive console and completed-login state', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-session-'));
  try {
    const common=await readFile(path.join(native,'wechat-background-safety.swift'),'utf8');
    const script=path.join(dir,'main.swift'),binary=path.join(dir,'fixture');
    await writeFile(script,common+`
let valid:[String:Any] = [kCGSessionOnConsoleKey as String:true,kCGSessionLoginDoneKey as String:true]
precondition(desktopSessionAllowsAutomation(valid))
precondition(!desktopSessionAllowsAutomation(nil))
precondition(!desktopSessionAllowsAutomation([:]))
for key in [kCGSessionOnConsoleKey as String,kCGSessionLoginDoneKey as String] {
 var state=valid; state.removeValue(forKey:key); precondition(!desktopSessionAllowsAutomation(state))
 state=valid; state[key]=false; precondition(!desktopSessionAllowsAutomation(state))
}
var locked=valid; locked["CGSSessionScreenIsLocked"]=true
precondition(!desktopSessionAllowsAutomation(locked))
print("session admission passed")
`);
    await run('/usr/bin/swiftc',['-O',script,'-o',binary],{timeout:60000});
    assert.match((await run(binary,[],{timeout:10000})).stdout,/session admission passed/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a captured process birth rejects replacements and malformed identity arguments', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-login-birth-'));
  try {
    const common=await readFile(path.join(native,'wechat-background-safety.swift'),'utf8');
    const script=path.join(dir,'main.swift'),binary=path.join(dir,'fixture');
    await writeFile(script, common+`
let pid=getppid()
if CommandLine.arguments.contains("--identity") {
 var birth=proc_bsdinfo()
 precondition(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&birth,Int32(MemoryLayout.size(ofValue:birth))) == MemoryLayout.size(ofValue:birth))
 print("\\(birth.pbi_start_tvsec) \\(birth.pbi_start_tvusec)")
} else { print(requestedProcessBirthMatches(pid)) }
`);
    await run('/usr/bin/swiftc',['-O',script,'-o',binary],{timeout:60000});
    const [seconds,micros]=(await run(binary,['--identity'])).stdout.trim().split(' ');
    assert.equal((await run(binary,['--expected-birth',seconds,micros])).stdout.trim(),'true');
    for(const args of [
      ['--expected-birth',String(Number(seconds)+1),micros], ['--expected-birth',seconds],
      ['--expected-birth','0',micros], ['--expected-birth',seconds,'1000000'],
      ['--expected-birth','invalid',micros], ['--expected-birth',seconds,micros,'--expected-birth',seconds,micros],
    ]) assert.equal((await run(binary,args)).stdout.trim(),'false');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('cold admission preserves manual and proven slow children, and only stops its unadmitted child', {skip:process.platform!=='darwin'}, async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'polymux-guard-child-'));
  try {
    const source=await readFile(path.join(native,'wechat-launch-hidden.swift'),'utf8');
    // Execute the production admission/cleanup block with disposable CLI
    // children. Only shorten its deadline; no application verification bypass
    // is compiled into the shipped launcher.
    const lifecycle=source.slice(source.indexOf('let deadline = Date().addingTimeInterval(12)'))
      .replace('addingTimeInterval(12)','addingTimeInterval(0.15)');
    const script=path.join(dir,'main.swift'),binary=path.join(dir,'fixture');
    await writeFile(script, `
import Foundation
import Darwin
let mode=CommandLine.arguments[1]
let child=Process(), decoy=Process(), bundle=URL(fileURLWithPath:"/fixture/WeChat.app")
child.executableURL=URL(fileURLWithPath:mode=="exited" ? "/usr/bin/true":"/bin/sleep")
child.arguments=mode=="exited" ? []:["60"]
decoy.executableURL=URL(fileURLWithPath:"/bin/sleep"); decoy.arguments=["60"]
try child.run(); try decoy.run()
let pid=child.processIdentifier
if mode=="exited" {child.waitUntilExit()}
struct NSRunningApplication {
 var processIdentifier:pid_t
 var isFinishedLaunching:Bool {mode != "slow"}
 var bundleURL:URL? {bundle}
 init?(processIdentifier:pid_t) {self.processIdentifier=processIdentifier}
}
struct Workspace {
 var frontmostApplication:NSRunningApplication? {NSRunningApplication(processIdentifier:mode=="manual" ? pid:pid+100)}
}
enum NSWorkspace {static let shared=Workspace()}
func verifiedBackgroundGuard(_ target:pid_t,requireBackground:Bool=true)->Bool {
 precondition(target==pid)
 return mode=="valid" || mode=="slow"
}
func output(_ payload:[String:Any],code:Int32=0)->Never {
 var result=payload;result["code"]=code;result["childRunning"]=child.isRunning;result["decoyRunning"]=decoy.isRunning
 if child.isRunning {Darwin.kill(pid,SIGTERM);child.waitUntilExit()}
 if decoy.isRunning {Darwin.kill(decoy.processIdentifier,SIGTERM);decoy.waitUntilExit()}
 print(String(data:try! JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
 exit(0)
}
${lifecycle}
`);
    await run('/usr/bin/swiftc',['-O',script,'-o',binary],{timeout:60000});
    for(const mode of ['valid','manual','slow','unverified','exited']) {
      const result=JSON.parse((await run(binary,[mode],{timeout:10000})).stdout);
      assert.equal(result.decoyRunning,true,mode);
      assert.equal(result.childRunning,['valid','manual','slow'].includes(mode),mode);
      assert.equal(result.ok,['valid','manual'].includes(mode),mode);
      if(mode==='manual')assert.equal(result.userOpened,true);
      if(mode==='slow')assert.equal(result.reason,'wechat_still_launching');
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
