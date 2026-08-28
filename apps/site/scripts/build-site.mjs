import {build} from 'vite';
import {generateBlogPages} from './generate-blog-pages.mjs';
import {generateDocsPages} from './generate-doc-pages.mjs';
import {generateReleasePages} from './generate-release-pages.mjs';
import {generateProductPages} from './generate-product-pages.mjs';
import {generateSitemap} from './generate-sitemap.mjs';

generateBlogPages();
generateDocsPages();
generateReleasePages();
generateProductPages();
generateSitemap();
await build();
