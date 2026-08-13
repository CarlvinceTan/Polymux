import {mount} from 'svelte';
import App from './App.svelte';

// macOS draws its traffic lights over a hidden-inset title bar, so the chat
// controls have to start clear of them. The stylesheet keys that inset off this
// attribute rather than guessing, and every other platform keeps the edge.
if (navigator.userAgent.includes('Mac OS X')) document.documentElement.dataset.platform = 'darwin';

mount(App, {target: document.getElementById('app')!});
