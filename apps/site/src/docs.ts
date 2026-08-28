import {mount} from 'svelte';
import DocsPage from './DocsPage.svelte';
import './docs.css';

mount(DocsPage, {target: document.getElementById('app')!});
