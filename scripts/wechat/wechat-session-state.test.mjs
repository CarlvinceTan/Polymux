import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
const run=promisify(execFile);

test('native session proof rejects signed-out accounts, changed pointers, layouts and malformed identities',
  {skip:process.platform!=='darwin'},async()=>{
    const source=await readFile(new URL('../../packages/wechat/src/native/wechat-session-state.swift',import.meta.url),'utf8');
    const method=source.slice(source.indexOf('func accountFingerprint('),source.indexOf('\nfunc probe()'));
    const directory=await mkdtemp(path.join(tmpdir(),'polymux-session-contract-'));
    try {
      const fixture=`import Foundation
import CryptoKit
enum ProbeFailure: Error { case unavailable }
final class RemoteMemory {
 var data: [UInt64:Data] = [:]
 var reads = 0
 var transition: ((RemoteMemory,UInt64)->Void)?
 func read(_ address: UInt64,_ count:Int) throws -> Data {
  reads += 1; transition?(self,address)
  guard let bytes=data[address],bytes.count == count else { throw ProbeFailure.unavailable };return bytes
 }
 func u64(_ address:UInt64) throws -> UInt64 { try read(address,8).withUnsafeBytes { $0.loadUnaligned(as:UInt64.self) } }
 func put(_ address:UInt64,_ value:UInt64) { var n=value;data[address]=withUnsafeBytes(of:&n){Data($0)} }
}
${method}
let base:UInt64=0x100000000, context:UInt64=0x200000000, account:UInt64=0x300000000
func fixture(_ identity:String="wxid_fixture")->RemoteMemory {
 let m=RemoteMemory();m.put(base+0x92fce98,context);m.put(context,base+0x8de8db0)
 m.put(context+0x68,account);m.put(account,base+0x8d8f0a8);m.data[account+0x38]=Data([1])
 var text=Data(identity.utf8);text.append(Data(repeating:0,count:23-text.count));text.append(UInt8(identity.utf8.count));m.data[account+0x48]=text;return m
}
func rejected(_ m:RemoteMemory) { do { _ = try accountFingerprint(m,base);fatalError("invalid state accepted") } catch {} }
let valid=fixture();let fingerprint=try accountFingerprint(valid,base)
assert(fingerprint==SHA256.hash(data:Data("wxid_fixture".utf8)).map{String(format:"%02x",$0)}.joined())
let loggedOut=fixture();loggedOut.data[account+0x38]=Data([0]);rejected(loggedOut)
let malformed=fixture("invalid/account");rejected(malformed)
let layout=fixture();layout.put(account,base+0x111);rejected(layout)
let moved=fixture();var contextReads=0
moved.transition={ m,address in if address==context+0x68 { contextReads += 1;if contextReads==2 {m.put(address,account+0x1000)} } };rejected(moved)
let logoutDuringRead=fixture();var activeReads=0
logoutDuringRead.transition={m,address in if address==account+0x38 {activeReads += 1;if activeReads==2 {m.data[address]=Data([0])}}};rejected(logoutDuringRead)
let long=fixture();var object=Data();for value:UInt64 in [0x400000000,129,0x8000000000000100] {var n=value;object.append(withUnsafeBytes(of:&n){Data($0)})};long.data[account+0x48]=object;rejected(long)
print("native session proof passed")
`;
      const input=path.join(directory,'contract.swift'), binary=path.join(directory,'contract');
      await writeFile(input,fixture);
      await run('/usr/bin/swiftc',[input,'-o',binary],{timeout:60_000});
      assert.match((await run(binary,[])).stdout,/native session proof passed/);
    }finally {await rm(directory,{recursive:true,force:true});}
  });
