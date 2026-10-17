#!/usr/bin/env python3
"""OpenAI-compatible inference through locally authenticated CLIs.

STANDIN_WORK selects the model workspace. Its parent holds providers.json,
prompt-audit.enabled and prompt-audit/; set it to reuse an existing installation.
Custom CLI installations must be on the launcher's PATH.
"""
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
from cli_env import environment

WORK=Path(os.environ.get('STANDIN_WORK',str(Path.home()/'.local/share/polymux/standin/model-workspace')))
LOCK=threading.Lock()
LAST={}
# Deny-all agent config: also passed inline per call so native tools stay denied even without the file.
CONFIG=json.dumps({'providers':{'opencode-go':{'models':{'deepseek-v4.1-flash':{'settings':{'reasoningEffort':'low'}}}}},'agents':{'standin':{'description':'Inference only, no native tools','permissions':[{'action':'*','resource':'*','effect':'deny'}], 'prompt':'Do not execute tools. Return only the requested JSON object.'}}})
SECRET=re.compile(r'-----BEGIN .*PRIVATE KEY|\b(?:sk-|ghp_|github_pat_|xox[baprs]-|ntn_|secret_)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?i:password|access[_-]?token|api[_-]?key)\s*[=:]\s*\S+')

RETRYABLE={'provider_unavailable','provider_error','provider_timeout','invalid_provider_response','invalid_content','invalid_tool'}

def audit_event(event):
    path=WORK.parent/'bridge-events.jsonl'
    fd=os.open(path,os.O_APPEND|os.O_CREAT|os.O_WRONLY,0o600)
    with os.fdopen(fd,'a') as f:f.write(json.dumps({'at':datetime.now(timezone.utc).isoformat(),**event})+'\n')

def bounded_request(request):
    messages=list(request.get('messages',[]))
    # Keep system instructions and the complete current turn, including tool exchanges.
    last=max((i for i,m in enumerate(messages) if m.get('role')=='user'),default=len(messages))
    system=[m for m in messages[:last] if m.get('role') in ('system','developer')]
    current=messages[last:]
    history=[m for m in messages[:last] if m.get('role') not in ('system','developer')]
    removed=0
    while len(json.dumps({**request,'messages':system+history+current},ensure_ascii=False).encode())>100000 and history:
        history.pop(0);removed+=1
        while history and history[0].get('role')!='user':history.pop(0);removed+=1
    result={**request,'messages':system+history+current}
    if removed:audit_event({'event':'context_trim','removed_messages':removed,'original_bytes':len(json.dumps(request).encode()),'selected_bytes':len(json.dumps(result).encode())})
    return result

def infer(request):
    original=request
    request=bounded_request(request)
    requested=request.get('model','local/opencode').removeprefix('local/')
    if requested not in ('opencode','cursor-agent'):raise ValueError('unsupported_provider')
    providers=['opencode','cursor-agent']
    providers=providers[providers.index(requested):]
    ident=uuid.uuid4().hex
    last=None
    for provider in providers:
        for attempt in range(3):
            try:
                result=infer_once({**request,'model':'local/'+provider})
                LAST['answered_provider']=provider
                original['_answered_provider']=provider
                audit_event({'request':ident,'event':'success','provider':provider,'attempt':attempt+1})
                return result
            except (ValueError,subprocess.TimeoutExpired,OSError) as exc:
                reason=str(exc) if isinstance(exc,ValueError) and not isinstance(exc,json.JSONDecodeError) else ('provider_timeout' if isinstance(exc,subprocess.TimeoutExpired) else ('provider_unavailable' if isinstance(exc,OSError) else 'invalid_provider_response'))
                if reason not in RETRYABLE:
                    audit_event({'request':ident,'event':'rejected','provider':provider,'reason':reason if reason in {'credential_input','credential_output','request_size','unsafe_provider_config','native_tool_rejected','invalid_tool'} else type(exc).__name__})
                    raise
                audit_event({'request':ident,'event':'failure','provider':provider,'attempt':attempt+1,'reason':reason})
                last=exc
                if attempt<2:time.sleep(2**attempt)
    raise ValueError('provider_unavailable') from last

def provider_run(argv,env,timeout):
    result=subprocess.run(argv,cwd=WORK,env=env,capture_output=True,text=True,timeout=timeout)
    if result.returncode:
        # Never record argv: it includes the user's prompt.
        audit_event({'event':'cli_error','bridge':Path(argv[0]).name,'exit_code':result.returncode,'stderr':SECRET.sub('[REDACTED]',result.stderr)[-4000:]})
        raise ValueError('provider_unavailable')
    return result

def prepare():
    WORK.mkdir(parents=True,exist_ok=True)
    p=WORK/'opencode.json';p.write_text(CONFIG);p.chmod(0o600)
    # Cursor's ask mode is read-only; additionally deny all native tool classes.
    p=WORK/'.cursor/cli.json';p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps({'permissions':{'allow':[],'deny':['Shell(*)','Read(*)','Write(*)','Edit(*)','WebFetch(*)','MCP(*)']}}));p.chmod(0o600)

def opencode(prompt, env):
    def api(path, data=None):
        argv=['opencode','api','POST' if data is not None else 'GET',path]
        if data is not None:argv+=['--data',json.dumps(data)]
        result=provider_run(argv,env,30)
        return json.loads(result.stdout)['data']
    session=api('/api/session',{'agent':'standin','title':'Polymux inference','location':{'directory':str(WORK)}})
    ident=session['id'];api('/api/session/'+ident+'/prompt',{'text':prompt})
    deadline=time.monotonic()+170
    while time.monotonic()<deadline:
        state=api('/api/session/'+ident)
        if state.get('outcome'):
            if state['outcome']!='succeeded':
                audit_event({'event':'opencode_error','session':ident,'outcome':state['outcome'],'error':SECRET.sub('[REDACTED]',json.dumps(state.get('error',{})))})
                raise ValueError('provider_error')
            messages=api('/api/session/'+ident+'/message')
            if any(m.get('type')=='tool' for m in messages):raise ValueError('native_tool_rejected')
            assistants=[m for m in messages if m.get('type')=='assistant']
            if not assistants:raise ValueError('invalid_provider_response')
            return ''.join(p.get('text','') for p in assistants[0].get('content',[]) if p.get('type')=='text')
        time.sleep(1)
    # Interrupt only this bridge's inference session; never the user's other work.
    api('/api/session/'+ident+'/interrupt',{})
    raise ValueError('provider_timeout')

def infer_once(request):
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
    if (WORK.parent/'prompt-audit.enabled').exists():
        audit=WORK.parent/'prompt-audit';audit.mkdir(mode=0o700,exist_ok=True)
        path=audit/(uuid.uuid4().hex+'.json')
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:json.dump({'model':provider,'prompt':SECRET.sub('[REDACTED]',prompt),'bytes':len(prompt.encode()),'credential_match':bool(SECRET.search(prompt))},f,ensure_ascii=False)
    if SECRET.search(prompt):raise ValueError('credential_input')
    if len(prompt.encode())>120000:raise ValueError('request_size')
    env=environment()
    env['OPENCODE_CONFIG_CONTENT']=CONFIG
    credentials=WORK.parent/'providers.json'
    if credentials.exists():
        if credentials.stat().st_mode & 0o077:raise ValueError('unsafe_provider_config')
        private=json.loads(credentials.read_text())
        if private.get('CURSOR_API_KEY'):env['CURSOR_API_KEY']=private['CURSOR_API_KEY']
    if provider=='cursor-agent':
        argv=['cursor-agent','-p','--trust','--mode','ask','--output-format','json',prompt]
    elif provider=='opencode':
        argv=None
    else:raise ValueError('unsupported_provider')
    with LOCK:
        if provider=='opencode':
            reply=opencode(prompt,env)
            result=None
        else:
            result=provider_run(argv,env,180)
    if provider=='cursor-agent':
        event=json.loads(result.stdout)
        if event.get('is_error'):
            audit_event({'event':'cursor_error','error':SECRET.sub('[REDACTED]',str(event.get('result','')))[:4000]})
            raise ValueError('provider_error')
        reply=event.get('result','')
    if SECRET.search(reply):raise ValueError('credential_output')
    reply=reply.strip()
    if reply.startswith('```'):reply=re.sub(r'^```(?:json)?\s*|\s*```$','',reply).strip()
    try:parsed=json.loads(reply)
    except json.JSONDecodeError:
        # Some CLIs add a sentence before the requested object.
        start=reply.find('{');end=reply.rfind('}')
        if start<0 or end<start:raise ValueError('invalid_provider_response')
        parsed=json.loads(reply[start:end+1])
    if not isinstance(parsed,dict) or not isinstance(parsed.get('tool_calls',[]),list):raise ValueError('invalid_provider_response')
    content=parsed.get('content','');calls=[]
    if not isinstance(content,str):raise ValueError('invalid_content')
    for item in parsed.get('tool_calls',[]):
        if not isinstance(item,dict) or not isinstance(item.get('name'),str):raise ValueError('invalid_provider_response')
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
        if self.path=='/v1/models':self.sendjson(200,{'object':'list','data':[{'id':x,'object':'model'} for x in ['local/opencode','local/cursor-agent']]});return
        self.sendjson(404,{'error':{'message':'Not found'}})
    def do_POST(self):
        if self.path!='/v1/chat/completions':self.sendjson(404,{'error':{'message':'Not found'}});return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=2*1024*1024:raise ValueError('request_size')
            request=json.loads(self.rfile.read(size));content,calls=infer(request)
        except Exception as e:
            reason=str(e) if isinstance(e,ValueError) and str(e) in ['credential_input','credential_output','provider_unavailable','provider_error','unsupported_provider','native_tool_rejected','invalid_provider_response','invalid_tool','request_size','provider_timeout','unsafe_provider_config'] else type(e).__name__
            self.sendjson(502,{'error':{'message':'Local model failed: '+reason,'type':'local_provider_error'}});return
        ident='chatcmpl-'+uuid.uuid4().hex;created=int(time.time());model='local/'+request.get('_answered_provider',request.get('model','opencode').removeprefix('local/'));finish='tool_calls' if calls else 'stop'
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
