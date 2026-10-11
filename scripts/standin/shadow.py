#!/usr/bin/env python3
"""Fail-closed SHADOW.md preflight. Never replay against live accounts."""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
from zoneinfo import ZoneInfo

ROOT=Path('/Users/carlvincetan/polymux')
MIRROR=ROOT/'in/polymux-merge'
OUT=ROOT/'standin/shadow'
DETECTORS={
 'email':re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
 'token':re.compile(r'\b(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA|ntn_|secret_)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'),
 'private_key':re.compile(r'-----BEGIN .*PRIVATE KEY'),
 'phone':re.compile(r'(?<![\w\d])\+\d[\d -]{7,14}\d\b'),
 'restricted_topic':re.compile(r'\b(bank|vault|hub|password|OTP)\b',re.I),
 'url_credential':re.compile(r'https?://[^\s]+:[^\s]+@|https?://[^\s]+[?&](token|key|password)=',re.I),
 'nric':re.compile(r'\b[STFGM]\d{7}[A-Z]\b'),
 'iban':re.compile(r'\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b')}

class Denied(Exception):pass

def dispatch(tool, arguments, fixtures):
    if tool in ['WebSearch','WebFetch','Read','SearchEmailThreads','ReadEmailThread']:
        key=hashlib.sha256(json.dumps([tool,arguments],sort_keys=True).encode()).hexdigest()
        return fixtures.get(key,{'fixture_miss':True,'result':'no fixture'})
    raise Denied('deny-by-default')

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    canary=False
    try:dispatch('SendEmail',{'to':'shadow-user@example.invalid'}, {})
    except Denied:canary=True
    rejected=[];counts=Counter();total=0
    for f in sorted((MIRROR/'shadow/raw').glob('*.jsonl')):
        for i,line in enumerate(f.read_text().splitlines()):
            total+=1;case=hashlib.sha256((f.stem+'|'+str(i)).encode()).hexdigest()[:16]
            # Typed placeholders are already scrubbed and never expanded.
            text=re.sub(r'<[A-Z]+_\d+>','<REDACTED>',line)
            names=[name for name,pattern in DETECTORS.items() if pattern.search(text)]
            if names:
                rejected.append({'case_id':case,'detectors':names});counts.update(names)
    # Only IDs and detector names are retained, never rejected contents.
    (OUT/'rejected.json').write_text(json.dumps(rejected,indent=2))
    now=datetime.now(ZoneInfo('Asia/Singapore'))
    ports=[]
    for port in range(47100,47200):
        sock=socket.socket()
        try:sock.bind(('127.0.0.1',port))
        except OSError:ports.append(port)
        finally:sock.close()
    cores=int(subprocess.check_output(['/usr/sbin/sysctl','-n','hw.ncpu']))
    import os
    load=os.getloadavg()[1]
    checks={
     'leak_hold_absent':not (MIRROR/'shadow/LEAK_HOLD').exists(),
     'deny_canary_blocked':canary,
     'dedicated_ports_free':not ports,
     'second_scrub_below_5_percent':total>0 and len(rejected)/total<=.05,
     'quiet_window':2<=now.hour<6,
     'load_below_limit':load<.5*cores,
     'container_or_vm_available':bool(shutil.which('docker') or shutil.which('podman')),
     'isolated_network_and_mounts_verified':False,
     'dedicated_spend_capped_model_and_judge_key':False,
     'judge_mapping_versions_pinned':False,
     'free_memory_above_6GB_verified':False,
     'trader_schedule_verified':False,
     'all_spec_scrub_detectors_implemented':False}
    report={'status':'BLOCKED','time_sgt':now.isoformat(),'cases_seen':total,'cases_rejected':len(rejected),'detector_counts':dict(counts),'checks':checks,'blocked':[k for k,v in checks.items() if not v], 'cases_replayed':0,'parity':None,'safety_violations':0,'note':'Preflight only. No live paths, connectors, models or transcript replay were executed. Full entropy/Luhn/address detectors and sandbox/judge infrastructure remain required.'}
    (OUT/'preflight.json').write_text(json.dumps(report,indent=2))
    (OUT/'REPORT.md').write_text('# Shadow preflight\n\nBLOCKED, 0 cases replayed, no parity score.\n\n'+''.join('- '+k+'\n' for k in report['blocked'])+'\nThe SendEmail canary was denied by the fixture dispatcher. Raw cases were scanned in memory; rejected content was not stored. This is not a passing behavioural parity run.\n')
    ledger=MIRROR/'LEDGER.md'
    with ledger.open('a') as f:f.write('\n| '+now.strftime('%Y-%m-%d %H:%M')+' | standin-fixes | preflight-v1 / judge-unconfigured | 0/'+str(len(rejected))+' | BLOCKED | — | — | — | — | disabled | — | 0 (no replay) |\n')
    print('Shadow preflight: BLOCKED;',total,'cases scanned;',len(rejected),'rejected; 0 replayed. See standin/shadow/REPORT.md.')
    return 2

if __name__=='__main__':raise SystemExit(main())
