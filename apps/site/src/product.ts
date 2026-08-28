import {mount} from 'svelte';
import ProductPage from './ProductPage.svelte';
import './analytics';
import './product.css';

mount(ProductPage, {target: document.getElementById('app')!});
