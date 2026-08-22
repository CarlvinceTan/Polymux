import {mount} from 'svelte';

// macOS draws its traffic lights over a hidden-inset title bar, so the chat
// controls have to start clear of them. The stylesheet keys that inset off this
// attribute rather than guessing, and every other platform keeps the edge.
if (navigator.userAgent.includes('Mac OS X')) document.documentElement.dataset.platform = 'darwin';

// The first document can be a splash-only shell while the main process starts
// app-scoped services. Its static markup and theme boot are already complete;
// importing App here would immediately call IPC before those services exist.
if (!new URLSearchParams(location.search).has('splashOnly')) {
  void import('./App.svelte')
    .then(({default: App}) => mount(App, {target: document.getElementById('app')!}))
    .catch((error) => console.error(`[renderer-import-stack] ${error?.stack ?? String(error)}`));
}
