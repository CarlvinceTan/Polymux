import type {HostClient} from './session.js';

export interface Choice {value: string; label: string; description?: string; status?: string}

/** Shared terminal interaction boundary. Forms never enter chat/history. */
export interface WorkspaceUi {
  client: HostClient;
  pick(title: string, items: Choice[]): Promise<string | undefined>;
  prompt(title: string, secret?: boolean): Promise<string | undefined>;
  show(title: string, text: string): Promise<void>;
  openChat(chat: {id: string; title: string}): Promise<void>;
  notify(text: string): void;
}

export async function confirm(ui: WorkspaceUi, title: string): Promise<boolean> {
  if (title.length > 60 || title.includes('\n')) {await ui.show('Review action', title); title = 'Confirm action';}
  return await ui.pick(title, [
    {value: 'cancel', label: 'Cancel'},
    {value: 'confirm', label: 'Confirm'},
  ]) === 'confirm';
}

export async function chooseProfile(ui: WorkspaceUi): Promise<string | undefined> {
  const profiles = await ui.client.call<Array<{id: string; name: string; teamEligible?: boolean}>>('team.profiles');
  return ui.pick('Connections profile', profiles.filter(p => p.teamEligible !== false)
    .map(p => ({value: p.id, label: p.name})));
}
