import {mount} from 'svelte';
import Releases from './Releases.svelte';
import './analytics';
import './releases.css';
import './lib/site-header.css';

mount(Releases, {target: document.getElementById('app')!});
