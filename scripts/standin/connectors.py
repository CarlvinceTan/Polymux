#!/usr/bin/env python3
"""Scoped MCP tools. Notion credentials are fetched from vault in memory."""
import json
import os
import re
import subprocess
import sys
import math
import urllib.request
import urllib.parse
from collections import Counter

BIN = "/Users/carlvincetan/code/agents/bin"
HUB = "/Users/carlvincetan/code/agents/hub/target/release/hub"
SECRET = re.compile(r"-----BEGIN .*PRIVATE KEY|\b(?:sk-|ghp_|github_pat_|xox[baprs]-|ntn_|secret_)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?i:password|api[_-]?key|access[_-]?token)\s*[=:]\s*\S+")

def clean(value):
    value=SECRET.sub("[REDACTED CREDENTIAL]", value)
    value=re.sub(r'(?i)(?:otp|verification code|one.time code|passcode|login code)\D{0,40}\d{4,10}', '[REDACTED AUTHENTICATION CODE]', value)
    value=re.sub(r'https?://[^\s"<>]+[?&](?:token|key|code|auth|signature|password)=[^\s"<>]+', '[REDACTED AUTHENTICATION URL]', value, flags=re.I)
    def entropy(match):
        text=match.group();size=len(text)
        score=-sum((n/size)*math.log2(n/size) for n in Counter(text).values())
        return '[REDACTED OPAQUE VALUE]' if score>4 else text
    return re.sub(r'[A-Za-z0-9_+/=-]{24,}',entropy,value)

def command(argv):
    env = dict(os.environ)
    env["PATH"] = BIN + ":/Users/carlvincetan/.cargo/bin:/Users/carlvincetan/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"
    result = subprocess.run(argv, capture_output=True, text=True, timeout=40, env=env)
    if result.returncode:
        return {"available": False, "exit_status": result.returncode, "message": "Connector unavailable; no raw error or credential disclosed."}
    return {"available": True, "result": clean(result.stdout[:40000])}

def notion(method, path, body=None):
    path = urllib.parse.unquote(path).lower()
    if 'comment' in path or not re.fullmatch(r'/v1/(?:search|pages|databases|(?:pages|databases|blocks)/[a-f0-9-]{32,36}(?:/query|/children)?)', path):
        raise ValueError('Notion endpoint denied')
    allowed = {'GET', 'PATCH'}
    if path in ('/v1/search', '/v1/pages', '/v1/databases') or path.endswith('/query'):
        allowed = {'POST'}
    if method not in allowed:
        raise ValueError('Notion operation denied')
    credential = subprocess.run(['/Users/carlvincetan/.local/bin/vault', 'get', 'Notion - Polymux integration token', '--field', 'password'], capture_output=True, text=True, timeout=20)
    if credential.returncode or not credential.stdout.strip():
        return {'available': False, 'message': 'Notion credential unavailable.'}
    token = json.loads(credential.stdout)['password']
    if not isinstance(token, str) or not token:
        return {'available': False, 'message': 'Notion credential unavailable.'}
    request = urllib.request.Request('https://api.notion.com'+path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Authorization': 'Bearer '+token, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            result = response.read(200000).decode()
        return {'available': True, 'result': clean(result.replace(token, '[REDACTED CREDENTIAL]'))}
    except Exception:
        return {'available': False, 'message': 'Notion request failed; private diagnostics withheld.'}

TOOLS = {
 "mail_accounts": ("List configured email accounts.", {}, []),
 "mail_list": ("Read recent mail envelopes, no flag changes or sends.", {"account":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":20}}, []),
 "mail_read": ("Read one mail without marking it seen, credentials redacted.", {"account":{"type":"string"},"id":{"type":"string"}}, ["id"]),
 "notion_api": ("Notion read, update, insert only. Comments are always denied.", {"method":{"type":"string","enum":["GET","POST","PATCH"]},"path":{"type":"string"},"body":{"type":"object"}}, ["method","path"]),
 "notion_search": ("Search accessible Notion pages. No writes.", {"query":{"type":"string"}}, []),
 "notion_read": ("Read a Notion page; use notion_api for block children.", {"id":{"type":"string"}}, ["id"]),
 "github_repo": ("Read GitHub repository metadata.", {"repo":{"type":"string"}}, ["repo"]),
 "matrix_rooms": ("Read joined Matrix rooms; no sends or marking read.", {}, []),
 "matrix_messages": ("Read recent Matrix messages; no sends.", {"room":{"type":"string"}}, ["room"]),
 "vault_status": ("Check vault availability. Never returns credentials or entries.", {}, [])}

def invoke(name, a):
    if name not in TOOLS: raise ValueError("unknown tool")
    for v in a.values():
        if isinstance(v,str) and (len(v)>512 or v.startswith('-') or '\x00' in v): raise ValueError("invalid argument")
    mail=["/opt/homebrew/bin/himalaya"]
    if a.get('account'): mail += ['--account',a['account']]
    if name=='mail_accounts': return command(mail+['account','list','--json'])
    if name=='mail_list': return command(mail+['envelope','list','--json','--page-size',str(max(1,min(20,int(a.get('limit',5)))))])
    if name=='mail_read':
        result=command(mail+['message','read','--json',a['id']])
        if re.search(r'one.time (?:password|code)|verification code|password reset|login (?:code|link)|sign.in link|magic link',result.get('result',''),re.I):
            result['result']='Authentication message withheld; use your email app to read it privately.'
        return result
    if name=='notion_api': return notion(a['method'],a['path'],a.get('body'))
    if name=='notion_search': return notion('POST','/v1/search',{'query':a.get('query',''),'page_size':10})
    if name=='notion_read':
        if not re.fullmatch('[a-fA-F0-9-]{32,36}',a['id']): raise ValueError('invalid page ID')
        return notion('GET','/v1/pages/'+a['id'])
    if name=='github_repo':
        if not re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',a['repo']): raise ValueError('invalid repository')
        return command([BIN+'/gh','repo','view',a['repo'],'--json','name,url,description,defaultBranchRef'])
    if name=='matrix_rooms': return command([HUB,'rooms'])
    if name=='matrix_messages': return command([HUB,'messages',a['room']])
    if name=='vault_status':
        result=command(['/Users/carlvincetan/.local/bin/vault','status'])
        return {'available':result['available'],'credential_access':'not exposed to agents'}

def main():
    for line in sys.stdin:
        try:
            r=json.loads(line); method=r.get('method'); ident=r.get('id')
            if ident is None: continue
            if method=='initialize': result={'protocolVersion':r.get('params',{}).get('protocolVersion','2024-11-05'),'capabilities':{'tools':{}},'serverInfo':{'name':'standin-connectors','version':'1'}}
            elif method=='ping': result={}
            elif method=='tools/list': result={'tools':[{'name':k,'description':v[0],'inputSchema':{'type':'object','properties':v[1],'required':v[2],'additionalProperties':False}} for k,v in TOOLS.items()]}
            elif method=='tools/call':
                p=r['params']; result={'content':[{'type':'text','text':json.dumps(invoke(p['name'],p.get('arguments',{})))}]}
            else: raise ValueError('unsupported method')
            out={'jsonrpc':'2.0','id':ident,'result':result}
        except Exception:
            out={'jsonrpc':'2.0','id':locals().get('ident'),'error':{'code':-32603,'message':'Scoped connector failed; no private diagnostic disclosed.'}}
        print(json.dumps(out),flush=True)

if __name__=='__main__': main()
