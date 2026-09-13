import {mount} from 'svelte';
import SharedConversation from './SharedConversation.svelte';
import '../../desktop/src/renderer/public/style.css';
import {applyTheme} from '../../desktop/src/renderer/lib/shared/theme';
applyTheme('system');
mount(SharedConversation, {target: document.getElementById('app')!});
