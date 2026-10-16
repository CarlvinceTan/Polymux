import {mount} from 'svelte';
import SharedConversation from './SharedConversation.svelte';
import './share-base.css';
import {applyTheme} from './lib/shared/theme';
applyTheme('system');
mount(SharedConversation, {target: document.getElementById('app')!});
