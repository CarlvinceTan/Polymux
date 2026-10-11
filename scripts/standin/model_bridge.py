#!/usr/bin/env python3
"""OpenAI-compatible inference through locally authenticated CLIs."""
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORK=Path('/Users/carlvincetan/polymux/standin/model-workspace')
LOCK=threading.Lock()
LAST={}
# Deny-all agent config: also passed inline per call so native tools stay denied even without the file.
CONFIG=json.dumps({'providers':{'opencode-go':{'models':{'deepseek-v4.1-flash':{'settings':{'reasoningEffort':'low'}}}}},'agents':{'standin':{'description':'Inference only, no native tools','permissions':[{'action':'*','resource':'*','effect':'deny'}], 'prompt':'Do not execute tools. Return only the requested JSON object.'}}})
SECRET=re.compile(r'-----BEGIN .*PRIVATE KEY|\b(?:sk-|ghp_|github_pat_|xox[baprs]-|ntn_|secret_)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?i:password|access[_-]?token|api[_-]?key)\s*[=:]\s*\S+')

def prepare():
    WORK.mkdir(parents=True,exist_ok=True)
    p=WORK/'opencode.json';p.write_text(CONFIG);p.chmod(0o600)
    # Cursor's ask mode is read-only; additionally deny all native tool classes.
    p=WORK/'.cursor/cli.json';p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps({'permissions':{'allow':[],'deny':['Shell(*)','Read(*)','Write(*)','Edit(*)','WebFetch(*)','MCP(*)']}}));p.chmod(0o600)

def opencode(prompt, env):
    def api(path, data=None):
        argv=['/Users/carlvincetan/.local/bin/opencode','api','POST' if data is not None else 'GET',path]
        if data is not None:argv+=['--data',json.dumps(data)]
        result=subprocess.run(argv,cwd=WORK,env=env,capture_output=True,text=True,timeout=30)
        if result.returncode:raise ValueError('provider_unavailable')
        return json.loads(result.stdout)['data']
    session=api('/api/session',{'agent':'standin','title':'Polymux inference','location':{'directory':str(WORK)}})
    ident=session['id'];api('/api/session/'+ident+'/prompt',{'text':prompt})
    deadline=time.monotonic()+170
    while time.monotonic()<deadline:
        state=api('/api/session/'+ident)
        if state.get('outcome'):
            if state['outcome']!='succeeded':raise ValueError('provider_error')
            messages=api('/api/session/'+ident+'/message')
            if any(m.get('type')=='tool' for m in messages):raise ValueError('native_tool_rejected')
            assistants=[m for m in messages if m.get('type')=='assistant']
            if not assistants:raise ValueError('invalid_provider_response')
            return ''.join(p.get('text','') for p in assistants[0].get('content',[]) if p.get('type')=='text')
        time.sleep(1)
    # Interrupt only this bridge's inference session; never the user's other work.
    api('/api/session/'+ident+'/interrupt',{})
    raise ValueError('provider_timeout')

def infer(request):
    global LAST
    provider=request.get('model','opencode').removeprefix('local/')
    tools={t['function']['name']:t['function'] for t in request.get('tools',[])}
    LAST={'model':provider,'tools':list(tools),'roles':[m.get('role') for m in request.get('messages',[])]}
    prompt=('You are the inference engine for Polymux. Do not execute any native CLI tools, read files, or access connectors. '
            'Follow the system messages in this JSON conversation. To use a supplied tool, return its name and arguments for Polymux to execute. '
            'Return ONLY one JSON object with exactly content (string) and tool_calls (array of {name:string,arguments:object}). '
            'If no tool is needed, tool_calls is []. Never fabricate tool results. Answer the newest user message, taking existing tool results into account.\n'
            +json.dumps({'messages':request.get('messages',[]),'tools':list(tools.values())},ensure_ascii=False))
    prompt+='\nNow continue this virtual conversation from its final message. Current tool schemas override prior assistant claims that a tool is unavailable. To actually act, emit tool_calls in the returned JSON, not a statement that you will act. When the newest user explicitly requests an available tool, return its call unless this newest turn already has a successful result for that call. Older tool results do not satisfy a new request. On a tool-call response, content should be empty. Do not return an announcement without the tool call. The response shape is exactly {"content":"...","tool_calls":[{"name":"supplied_tool_name","arguments":{}}]}.'
    if SECRET.search(prompt):raise ValueError('credential_input')
    if len(prompt.encode())>120000:raise ValueError('request_size')
    env=dict(os.environ);env['PATH']='/Users/carlvincetan/code/agents/bin:/Users/carlvincetan/.cargo/bin:/Users/carlvincetan/.local/bin:/opt/homebrew/bin:'+env.get('PATH','/usr/bin:/bin')
    env['OPENCODE_CONFIG_CONTENT']=CONFIG
    env['HOME']='/Users/carlvincetan'
    credentials=WORK.parent/'providers.json'
    if credentials.exists():
        if credentials.stat().st_mode & 0o077:raise ValueError('unsafe_provider_config')
        private=json.loads(credentials.read_text())
        if private.get('CURSOR_API_KEY'):env['CURSOR_API_KEY']=private['CURSOR_API_KEY']
    if provider=='cursor-agent':
        argv=['/Users/carlvincetan/.local/bin/cursor-agent','-p','--trust','--mode','ask','--output-format','json',prompt]
    elif provider=='opencode':
        argv=None
    elif provider=='codex':
        if datetime.now(timezone.utc).date().isoformat()>'2026-10-30':raise ValueError('provider_expired')
        argv=['/opt/homebrew/bin/codex','exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','-c','features.shell_tool=false','-c','features.apply_patch_freeform=false',prompt]
    else:raise ValueError('unsupported_provider')
    with LOCK:
        if provider=='opencode':
            reply=opencode(prompt,env)
            result=None
        else:
            result=subprocess.run(argv,cwd=WORK,env=env,capture_output=True,text=True,timeout=180)
    if result is not None and result.returncode:raise ValueError('provider_unavailable')
    if provider=='cursor-agent':
        event=json.loads(result.stdout)
        if event.get('is_error'):raise ValueError('provider_error')
        reply=event.get('result','')
    elif provider=='codex':
        reply=''
        for line in result.stdout.splitlines():
            try:event=json.loads(line)
            except json.JSONDecodeError:continue
            if event.get('type') in ['tool_use','tool','tool_call']:raise ValueError('native_tool_rejected')
            if event.get('type')=='text':reply+=event.get('part',{}).get('text','')
            if provider=='codex' and event.get('type')=='item.completed':
                item=event.get('item',{})
                if item.get('type') in ['command_execution','mcp_tool_call']:raise ValueError('native_tool_rejected')
                if item.get('type')=='agent_message':reply+=item.get('text','')
    if SECRET.search(reply):raise ValueError('credential_output')
    reply=reply.strip()
    if reply.startswith('```'):reply=re.sub(r'^```(?:json)?\s*|\s*```$','',reply).strip()
    try:parsed=json.loads(reply)
    except json.JSONDecodeError:
        # Some CLIs add a sentence before the requested object.
        start=reply.find('{');end=reply.rfind('}')
        if start<0 or end<start:raise ValueError('invalid_provider_response')
        parsed=json.loads(reply[start:end+1])
    content=parsed.get('content','');calls=[]
    if not isinstance(content,str):raise ValueError('invalid_content')
    for item in parsed.get('tool_calls',[]):
        name=item['name'];args=item.get('arguments',{})
        if name not in tools or not isinstance(args,dict):raise ValueError('invalid_tool')
        calls.append({'id':'call_'+uuid.uuid4().hex,'type':'function','function':{'name':name,'arguments':json.dumps(args)}})
    LAST['emitted_tools']=[c['function']['name'] for c in calls]
    return content,calls

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def sendjson(self,status,payload):
        data=json.dumps(payload).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path=='/health':self.sendjson(200,{'status':'ok','last_request':LAST});return
        if self.path=='/v1/models':self.sendjson(200,{'object':'list','data':[{'id':x,'object':'model'} for x in ['local/opencode','local/cursor-agent','local/codex']]});return
        self.sendjson(404,{'error':{'message':'Not found'}})
    def do_POST(self):
        if self.path!='/v1/chat/completions':self.sendjson(404,{'error':{'message':'Not found'}});return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=2*1024*1024:raise ValueError('request_size')
            request=json.loads(self.rfile.read(size));content,calls=infer(request)
        except Exception as e:
            reason=str(e) if isinstance(e,ValueError) and str(e) in ['credential_input','credential_output','provider_unavailable','provider_error','unsupported_provider','native_tool_rejected','invalid_provider_response','invalid_tool'] else type(e).__name__
            self.sendjson(502,{'error':{'message':'Local model failed: '+reason,'type':'local_provider_error'}});return
        ident='chatcmpl-'+uuid.uuid4().hex;created=int(time.time());model=request.get('model','opencode');finish='tool_calls' if calls else 'stop'
        usage={'prompt_tokens':0,'completion_tokens':0,'total_tokens':0}
        if not request.get('stream'):
            message={'role':'assistant','content':content}
            if calls:message['tool_calls']=calls
            self.sendjson(200,{'id':ident,'object':'chat.completion','created':created,'model':model,'choices':[{'index':0,'message':message,'finish_reason':finish}],'usage':usage});return
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-cache');self.end_headers()
        delta={'role':'assistant','content':content}
        if calls:delta['tool_calls']=[dict(c,index=i) for i,c in enumerate(calls)]
        for part in [{'choices':[{'index':0,'delta':delta,'finish_reason':None}]},{'choices':[{'index':0,'delta':{},'finish_reason':finish}],'usage':usage}]:
            packet={'id':ident,'object':'chat.completion.chunk','created':created,'model':model,**part}
            self.wfile.write(('data: '+json.dumps(packet)+'\n\n').encode());self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()

if __name__=='__main__':prepare();ThreadingHTTPServer(('127.0.0.1',8790),Handler).serve_forever()
