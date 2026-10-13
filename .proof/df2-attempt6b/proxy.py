"""Loopback-only deterministic transport for the Release activity proof."""
import datetime
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

agents = [dict(id='t-' + n.lower(), name=n, role='', model='', active=True)
          for n in ['Chief', 'Aria', 'Milo', 'Nova', 'Approval', 'Fern']]
ids = ['t-chief', 't-aria', 't-milo', 't-nova', 't-long', 't-stream',
       't-approval', 'grp-trip', 't-media', 't-activity', 't-fern', 'grp-empty']
threads = [dict(id=i, agentID='t-chief', agentIDs=['t-chief', 't-milo'],
                title=i, runs=[], lastReadSeq=0, lastSeq=0, unreadCount=0) for i in ids]
settings = dict(revision=1, appearance='light', sidebarWidth=360, voiceMode='',
                liveProvider='', liveModel='', liveVoice='', textProvider='',
                textModel='', voicePrompt='', speechKeys=[])

def events(thread):
    output = []
    for block in range(100 if thread == 't-long' else 1):
        at = (datetime.datetime(2026, 10, 13, 12, tzinfo=datetime.timezone.utc)
              + datetime.timedelta(minutes=block * 2)).isoformat().replace('+00:00', 'Z')
        seq = block * 7 + 1
        message = dict(id=f'{thread}-{block}', threadID=thread, role='user',
                       parts=[dict(kind='text', text=f'Review release {block + 1} and remember the rollout plan.')],
                       createdAt=at, status='done', seq=seq)
        output.append(dict(seq=seq, conversationID=thread, type='message.done', message=message, createdAt=at))
        rows = [('tool.called', 'Checked', '', 'release status', 'terminal'),
                ('agent.messaged', 'Messaged', '', '', 't-milo'),
                *[('tool.called', 'Searched', '', '', 'magnifyingglass')] * 3,
                ('memory.created', 'Saved', 'rollout-plan', 'Rollout plan', 'brain')]
        for offset, (kind, verb, obj, label, icon) in enumerate(rows, 1):
            payload = dict(kind=kind, verb=verb, objectID=obj, objectLabel=label, iconOrAgentID=icon, at=at)
            if kind == 'agent.messaged': payload['agentIDs'] = ['t-chief', 't-milo']
            output.append(dict(seq=seq + offset, conversationID=thread, type='activity',
                               agentID='t-chief', createdAt=at, payload=payload))
    return output if thread in ['t-long', 't-activity'] else []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def do_GET(self):
        url = urlparse(self.path)
        parts = url.path.strip('/').split('/')
        key = parts[-1]
        thread = parts[1] if len(parts) > 2 and parts[0] == 'threads' else ''
        query = parse_qs(url.query)
        if key == 'stream':
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            try:
                while True: self.wfile.write(b': keepalive\n\n'); self.wfile.flush(); time.sleep(1)
            except (BrokenPipeError, ConnectionResetError): return
        if key == 'agents': data = agents
        elif key == 'threads': data = threads
        elif key == 'settings': data = settings
        elif key == 'events': data = [e for e in events(thread) if e['seq'] > int(query.get('after', ['0'])[0])]
        elif key == 'messages':
            before = int(query.get('before', ['999999'])[0])
            data = [e['message'] for e in events(thread) if e['type'] == 'message.done' and e['seq'] < before][-100:]
        elif '/activity/' in url.path: data = dict(text='Rollout plan: verify the release before enabling the routine.')
        else: data = {}
        body = json.dumps(data).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_PATCH(self):
        settings.update(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)))))
        settings['revision'] += 1
        self.do_GET()
    def do_POST(self): self.do_GET()

ThreadingHTTPServer(('127.0.0.1', 48739), Handler).serve_forever()
