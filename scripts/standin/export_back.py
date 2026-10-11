#!/usr/bin/env python3
"""Produce a reviewable one-way mirror diff; never apply it to Grok Bot."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import difflib
import json
import os
from pathlib import Path
import subprocess
import time
from connectors import SECRET

ROOT=Path('/Users/carlvincetan/polymux')
OUT=ROOT/'standin'
SNAPSHOT=ROOT/'in/polymux-merge/mirror/snapshot'

def safe_write(path,text):
    if SECRET.search(text):raise ValueError('credential pattern rejected; no content written')
    path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:f.write(text)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true',help='server is already stopped');args=parser.parse_args()
    domain='gui/'+str(os.getuid());label='com.polymux.server';plist=Path.home()/'Library/LaunchAgents'/ (label+'.plist')
    running=False
    if not args.offline:
        running=subprocess.run(['/bin/launchctl','print',domain+'/'+label],capture_output=True).returncode==0
        if running:
            result=subprocess.run(['/bin/launchctl','bootout',domain+'/'+label],capture_output=True)
            if result.returncode:raise RuntimeError('server could not be stopped safely')
    try:
        result=None
        for _ in range(30):
            result=subprocess.run([str(ROOT/'bin/polymux-import'),'export',str(ROOT/'data')],capture_output=True,text=True)
            if result.returncode==0:break
            time.sleep(.2)
        if result.returncode:raise RuntimeError('store export failed; no diff written')
        if SECRET.search(result.stdout):raise ValueError('credential pattern rejected; no export written')
        current=json.loads(result.stdout)
    finally:
        if running:
            for _ in range(30):
                restart=subprocess.run(['/bin/launchctl','bootstrap',domain,str(plist)],capture_output=True)
                if restart.returncode==0:break
                time.sleep(.2)
            if restart.returncode:raise RuntimeError('server restart failed; run launchctl bootstrap using carl-handoff.md')
    baseline=json.loads((OUT/'baseline.json').read_text())
    old={(m['owner'],m['scope'],m['document']['name']):m for m in baseline.get('memory',[])}
    names={d['agent']['id']:d['agent']['name'].lower() for d in current['definitions']}
    target=OUT/'sync-back'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target.mkdir(parents=True,mode=0o700)
    patch=[];byagent=defaultdict(list);active=set()
    for m in current.get('memory',[]):
        key=(m['owner'],m['scope'],m['document']['name']);active.add(key)
        if key in old and old[key]['document']['text']==m['document']['text']:continue
        d=m['document'];byagent[names[m['owner']]].append({'agent':names[m['owner']],'agent_id':m['owner'],'scope':m['scope'],'name':d['name'],'text':d['text'],'source':'polymux:'+d['source'],'updated_at':d['updatedAt'],'operation':'upsert'})
    for key,m in old.items():
        if key not in active:byagent[names[m['owner']]].append({'agent':names[m['owner']],'scope':m['scope'],'name':key[2],'operation':'delete','review_required':True})
    def write_diff(relative,before,after):
        if before==after:return
        safe_write(target/relative,after)
        patch.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+relative,tofile='b/'+relative))
    for name,items in sorted(byagent.items()):write_diff('memory/'+name+'.jsonl','', ''.join(json.dumps(x,sort_keys=True)+'\n' for x in items))
    for p in (ROOT/'data/skills').rglob('SKILL.md'):
        rel=str(p.relative_to(ROOT/'data'))
        oldfile=SNAPSHOT/rel
        write_diff(rel,oldfile.read_text() if oldfile.exists() else '',p.read_text())
    original={r['id']:r for r in baseline.get('routines',[])}
    changes=[]
    for r in current.get('routines',[]):
        if r.get('id')=='standin-proof' or r.get('prompt','').startswith('Stand-in proof:'):continue
        if original.get(r['id'])==r:continue
        changes.append({**r,'enabled':r['status']=='active','mirrored':True,'mirror_note':'review before enabling in Grok Bot','agent':names[r['agentID']]})
    if changes:write_diff('routines/routines.jsonl','', ''.join(json.dumps(x,sort_keys=True)+'\n' for x in changes))
    safe_write(target/'review.patch',''.join(patch))
    safe_write(target/'manifest.json',json.dumps({'source':'Polymux','direction':'one-way review only','memory_changes':sum(map(len,byagent.values())),'routine_changes':len(changes),'patch_empty':not patch},indent=2)+'\n')
    print('Review diff:',target/'review.patch')

if __name__=='__main__':main()
