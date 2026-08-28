import {mount} from 'svelte';
import App from './App.svelte';
import './analytics';
import './styles.css';
import './lib/site-header.css';

mount(App, {target: document.getElementById('app')!});
