import {mount} from 'svelte';
import ProductPage from './ProductPage.svelte';
import './product.css';

mount(ProductPage, {target: document.getElementById('app')!});
