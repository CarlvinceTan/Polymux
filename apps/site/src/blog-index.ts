import {mount} from 'svelte';
import BlogIndex from './BlogIndex.svelte';
import './analytics';
import './blog.css';

mount(BlogIndex, {target: document.getElementById('app')!});
