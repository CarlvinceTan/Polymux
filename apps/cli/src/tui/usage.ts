import type {UsageSummary} from '@polymux/storage';
import type {UsageDiscoveryDto} from '@polymux/protocol';
import type {WorkspaceUi} from './workspace-ui.js';

export async function browseUsage(ui: WorkspaceUi): Promise<void> {
  for (;;) {
    const scope = await ui.pick('Usage', [
      {value: 'all', label: 'All detectable agents'}, {value: 'polymux', label: 'Polymux'},
      {value: 'assistant', label: 'Assistant'}, {value: 'team', label: 'Team'},
    ]);
    if (!scope) return;
    let refresh = false;
    for (;;) {
      const usage = await ui.client.call<UsageSummary & {discovery?: UsageDiscoveryDto}>('usage.get', [{scope, refresh}]);
      refresh = false;
      const action = await ui.pick(`${scope === 'all' ? 'All agents' : scope} · ${usage.lifetimeTokens.toLocaleString()} tokens · $${usage.costUsd.toFixed(2)} USD`, [
        {value: 'summary', label: 'Summary', description: `${usage.totalChats} chats${usage.discovery ? ` · discovery ${usage.discovery.status}` : ''}`},
        {value: 'refresh', label: 'Refresh'},
        ...usage.agents.map(a => ({value: a.id, label: a.name, description: `${a.runs} runs · ${a.tokens.toLocaleString()} tokens`, status: `$${a.costUsd.toFixed(2)}`})),
      ]);
      if (!action) break;
      if (action === 'refresh') {refresh = true; continue;}
      const data = action === 'summary' ? usage : await ui.client.call<UsageSummary>('usage.get', [{scope, agentId: action}]);
      await ui.show('Usage', `${data.lifetimeTokens.toLocaleString()} tokens\n$${data.costUsd.toFixed(2)} USD\n${data.totalChats} chats\n\nModels\n` + data.models.map(m => `${m.model}\n${m.tokens.toLocaleString()} tokens · ${m.runs} runs · $${m.costUsd.toFixed(2)} USD`).join('\n\n'));
    }
  }
}
