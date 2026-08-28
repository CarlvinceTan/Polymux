import {mount} from 'svelte';
import BlogPost from './BlogPost.svelte';
import './blog.css';

mount(BlogPost, {target: document.getElementById('app')!});
