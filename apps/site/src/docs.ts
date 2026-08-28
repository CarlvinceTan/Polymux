import {mount} from 'svelte';
import DocsPage from './DocsPage.svelte';
import './analytics';
import './docs.css';
import './lib/site-header.css';

mount(DocsPage, {target: document.getElementById('app')!});
