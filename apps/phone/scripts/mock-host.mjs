import {createServer} from 'node:http';

const port = Number(process.env.POLYMUX_PHONE_MOCK_PORT || 47881);
const secret = process.env.POLYMUX_PHONE_MOCK_SECRET || 'phone-e2e-secret';
const now = new Date().toISOString();
const conversations = [
  {id: 'assistant-main', title: 'Assistant', createdAt: now, updatedAt: now, archivedAt: null},
  {id: 'team-research', title: 'Maya', createdAt: now, updatedAt: now, archivedAt: null},
];
const messages = {
  'assistant-main': [
    {
      id: 'message-user', conversationId: 'assistant-main', runId: null, role: 'user',
      content: 'Give me the short version of today’s priorities.', createdAt: now,
      sequence: 1, attachments: [], metadata: {},
    },
    {
      id: 'message-assistant', conversationId: 'assistant-main', runId: 'run-complete', role: 'assistant',
      content: 'Focus on **shipping the phone companion**, reviewing Team handoffs, and keeping the Desktop Host online.',
      createdAt: now, sequence: 2, attachments: [], metadata: {},
    },
  ],
  'team-research': [
    {
      id: 'message-maya', conversationId: 'team-research', runId: 'run-maya', role: 'assistant',
      content: 'I’ve collected the relevant sources and left a concise comparison ready for review.',
      createdAt: now, sequence: 1, attachments: [], metadata: {},
    },
  ],
};
const team = [{
  id: 'maya', conversationId: 'team-research', name: 'Maya', role: 'Research',
  profileId: 'default', profileName: 'Default', avatar: {shape: 'pebble', color: '#8B7CF6'},
  laptopAccess: 'ask', status: 'idle',
  preview: 'Comparison ready for review', updatedAt: now, unread: true, unreadCount: 4,
  hostId: 'phone-qa-host', hostName: 'MacBook Pro',
  computer: {provider: 'unavailable', state: 'unavailable', detail: null, persistent: true, network: 'none'},
}];

function avatar(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const alexAvatar = avatar(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e2b796"/><stop offset="1" stop-color="#8f5f48"/></linearGradient></defs>
    <rect width="96" height="96" rx="24" fill="url(#b)"/>
    <circle cx="48" cy="40" r="19" fill="#f2c8a6"/>
    <path d="M27 39c1-19 12-27 22-27 15 0 24 12 21 29-5-8-11-13-19-16-7 7-15 11-24 14Z" fill="#2d241f"/>
    <path d="M16 96c3-24 15-35 32-35s29 11 32 35" fill="#274c62"/>
    <circle cx="41" cy="42" r="1.8" fill="#3b2a22"/><circle cx="56" cy="42" r="1.8" fill="#3b2a22"/>
    <path d="M43 51c3 3 8 3 11 0" fill="none" stroke="#9d5f55" stroke-width="2" stroke-linecap="round"/>
  </svg>
`);

const familyAvatar = avatar(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="24" fill="#d9c7b5"/>
    <rect x="5" y="5" width="41" height="41" rx="14" fill="#b66c52"/>
    <rect x="50" y="5" width="41" height="41" rx="14" fill="#718d72"/>
    <rect x="5" y="50" width="41" height="41" rx="14" fill="#54768a"/>
    <rect x="50" y="50" width="41" height="41" rx="14" fill="#be9660"/>
    <g fill="#f3d1b6"><circle cx="25.5" cy="23" r="9"/><circle cx="70.5" cy="23" r="9"/><circle cx="25.5" cy="68" r="9"/><circle cx="70.5" cy="68" r="9"/></g>
    <g fill="#fff" opacity=".85"><path d="M11 46c2-11 7-16 15-16s13 5 15 16"/><path d="M56 46c2-11 7-16 15-16s13 5 15 16"/><path d="M11 91c2-11 7-16 15-16s13 5 15 16"/><path d="M56 91c2-11 7-16 15-16s13 5 15 16"/></g>
  </svg>
`);

const fileTransferAvatar = avatar(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="24" fill="#fff"/>
    <path d="M28 25h40a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H50L36 76V65h-8a9 9 0 0 1-9-9V34a9 9 0 0 1 9-9Z" fill="#171717"/>
    <path d="m38 46 8 8 15-17" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`);

const hubChats = [
  {
    id: 'hub-family', name: 'Family', platform: 'whatsapp', unread: 3, group: true,
    preview: 'Dinner at 7 works for everyone', lastActivity: now, avatarUrl: familyAvatar,
  },
  {
    id: 'hub-instagram', name: 'Alex Rivera', platform: 'instagram', unread: 2, group: false,
    preview: 'The latest preview looks great', lastActivity: new Date(Date.now() - 8 * 60_000).toISOString(),
    avatarUrl: alexAvatar,
  },
  {
    id: 'hub-filehelper', name: 'File Transfer', platform: 'wechat', unread: 0, group: false,
    preview: 'polymux-phone-build.zip', lastActivity: new Date(Date.now() - 3_600_000).toISOString(), avatarUrl: fileTransferAvatar,
  },
];
const hubMessages = {
  'hub-family': [
    {
      id: 'hub-family-2', chatId: 'hub-family', sender: '@alex:example.com', senderName: 'Alex',
      senderAvatarUrl: alexAvatar, body: 'Dinner at 7 works for everyone', sentAt: now, mine: false,
      attachments: [], reactions: [], replyTo: null,
    },
    {
      id: 'hub-family-1', chatId: 'hub-family', sender: '@me:example.com', senderName: 'You',
      body: 'Should we meet at the usual place?', sentAt: new Date(Date.now() - 180_000).toISOString(), mine: true,
      attachments: [], reactions: [], replyTo: null,
    },
  ],
  'hub-instagram': [
    {
      id: 'hub-instagram-1', chatId: 'hub-instagram', sender: '@alex:example.com', senderName: 'Alex Rivera',
      senderAvatarUrl: alexAvatar, body: 'The latest preview looks great',
      sentAt: new Date(Date.now() - 8 * 60_000).toISOString(), mine: false,
      attachments: [], reactions: [], replyTo: null,
    },
  ],
  'hub-filehelper': [
    {
      id: 'hub-file-1', chatId: 'hub-filehelper', sender: '@me:example.com', senderName: 'You',
      body: 'polymux-phone-build.zip', sentAt: new Date(Date.now() - 3_600_000).toISOString(), mine: true,
      attachments: [{id: 'attachment-1', name: 'polymux-phone-build.zip', mimeType: 'application/zip', size: 204800}],
      reactions: [], replyTo: null,
    },
  ],
};

function reply(response, status, value) {
  response.writeHead(status, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    reply(response, 204, null);
    return;
  }
  if (request.method === 'GET' && request.url === '/polymux-host/v1/health') {
    reply(response, 200, {
      ok: true, hostId: 'phone-qa-host', deviceName: 'Polymux QA Host', paired: true,
      apiVersion: 1, capabilities: ['assistant', 'team', 'hub', 'runs', 'uploads'],
    });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/polymux-host/v1/rpc') {
    reply(response, 404, {error: 'Not found'});
    return;
  }
  if (request.headers.authorization !== `Bearer ${secret}`) {
    reply(response, 401, {error: 'Unauthorized'});
    return;
  }
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const {method, args = []} = JSON.parse(body);
    if (method === 'team.markRead') {
      const member = team.find((item) => item.id === args[0]);
      if (member) {
        member.unread = false;
        member.unreadCount = 0;
      }
    }
    if (method === 'hub.markRead') {
      const chat = hubChats.find((item) => item.id === args[0]);
      if (chat) chat.unread = 0;
    }
    if (method === 'hub.send') {
      const sent = {
        id: `hub-sent-${Date.now()}`, chatId: args[0], sender: '@me:example.com', senderName: 'You',
        body: args[1], sentAt: new Date().toISOString(), mine: true, attachments: [], reactions: [], replyTo: null,
      };
      hubMessages[args[0]] = [sent, ...(hubMessages[args[0]] || [])];
      const chat = hubChats.find((item) => item.id === args[0]);
      if (chat) Object.assign(chat, {preview: sent.body, lastActivity: sent.sentAt, unread: 0});
    }
    if (method === 'hub.sendFiles') {
      for (const file of args[1] || []) {
        const sent = {
          id: `hub-file-${Date.now()}-${file.name}`, chatId: args[0], sender: '@me:example.com', senderName: 'You',
          body: file.name, sentAt: new Date().toISOString(), mine: true,
          attachments: [{id: `attachment-${Date.now()}`, name: file.name, mimeType: file.mimeType, size: 0}],
          reactions: [], replyTo: null,
        };
        hubMessages[args[0]] = [sent, ...(hubMessages[args[0]] || [])];
      }
    }
    const result = method === 'conversations.list' ? conversations
      : method === 'team.list' ? team
        : method === 'hub.chats' ? hubChats
          : method === 'hub.messages' ? {messages: (hubMessages[args[0]] || []).slice(0, args[1] || 50), nextBefore: null}
            : method === 'hub.send' ? hubMessages[args[0]]?.[0] || null
              : method === 'hub.markRead' || method === 'hub.sendFiles' ? null
        : method === 'runs.activeAll' ? []
          : method === 'conversations.messages' ? messages[args[0]] || []
            : method === 'team.markRead' ? {...team[0], unread: false, unreadCount: 0}
              : null;
    reply(response, 200, {result});
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Polymux phone mock Host listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
