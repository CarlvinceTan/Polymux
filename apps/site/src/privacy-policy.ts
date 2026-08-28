import {mount} from 'svelte';
import PrivacyPolicy from './PrivacyPolicy.svelte';
import './analytics';

mount(PrivacyPolicy, {target: document.getElementById('app')!});
