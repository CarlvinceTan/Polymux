import{C as e,D as t,E as n,F as r,L as i,O as a,P as o,R as s,S as c,T as l,c as u,d,f,g as p,h as m,i as h,k as g,l as _,m as v,p as y,t as b,u as x,v as S}from"./polymux-CnpS2t3f.js";import{s as C,t as w}from"./ProductMenu-BzTBqPl3.js";import"./legacy-D-oaa6pt.js";import{n as T,t as E}from"./browser-DCIRAqli.js";var D=Object.assign({"../content/releases/0.2.2.md":`---
version: 0.2.2
title: Release notes in your workspace
date: 2026-08-28
summary: Polymux now shows the latest release inside your workspace after an update, alongside new documentation and product writing.
published: true
---

## Features

- After Polymux updates and restarts, the matching release page opens in a new Browser tab inside the workspace drawer.
- Release pages have permanent versioned URLs, making it easy to revisit or share exactly what changed.
- The new [documentation centre](/docs/) covers setup, the workspace, Hub, Drive, Browser, models, skills, privacy, and troubleshooting.
- The new [Polymux Blog](/blog/) is a home for product thinking, comparisons, and lessons from building the app.

## Improvements

- On macOS, the main action now simply says **Download**. Platform and version details still appear beside it when useful.
- Fresh installs stay focused on setup. Release notes begin appearing with the first later update and appear only once per version.

## First article

The first Polymux Blog article compares the different approaches taken by Polymux, Hermes Agent, OpenClaw, and Khoj.
`,"../content/releases/0.2.3.md":`---
version: 0.2.3
title: Richer conversations across your workspace
date: 2026-08-28
summary: This release expands Hub conversations, improves Browser controls, and makes setup and packaged connections more reliable.
published: true
---

## Features

- Send a private broadcast to contacts across multiple messaging platforms while keeping every delivery in its own direct conversation.
- Copy message text, links, images, and file attachments in formats that paste naturally into other apps.
- Filter conversations by read state, change their activity order, and work with cleaner deduplicated contact results.
- See search suggestions in Browser and switch more naturally between desktop and mobile page layouts as the workspace resizes.

## Improvements

- Reactions, sender names, media, conversation history, and mail draft autosaving behave more consistently across connected services.
- First-run permission guidance now follows the capabilities and controls available on the current operating system.
- Packaged releases validate built-in service connections and the bundled messaging bridge fleet before publishing.
- The website now includes permanent release notes, product pages, documentation, and the Polymux Blog.
`});function O(e,t){let n=t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);if(!n)throw Error(`Release ${e} is missing YAML front matter.`);let r=E(n[1]);if(r.published===!1)return null;let i=String(r.version??``).trim(),a=String(r.title??``).trim(),o=String(r.date??``).trim(),s=String(r.summary??``).trim(),c=n[2].trim();if(!i||!a||!o||!s)throw Error(`Release ${e} requires version, title, date, and summary fields.`);return{version:i,title:a,date:o,summary:s,body:c,html:T.parse(c,{gfm:!0})}}var k=Object.entries(D).map(([e,t])=>O(e,t)).filter(e=>e!==null).sort((e,t)=>t.date.localeCompare(e.date)||t.version.localeCompare(e.version,void 0,{numeric:!0}));function A(e){return k.find(t=>t.version===e)}function j(e){return`/releases/${encodeURIComponent(e)}/`}function M(e){return new Intl.DateTimeFormat(`en-AU`,{day:`numeric`,month:`short`,year:`numeric`,timeZone:`UTC`}).format(new Date(`${e}T00:00:00Z`))}function N(e){return new Intl.DateTimeFormat(`en-AU`,{month:`long`,year:`numeric`,timeZone:`UTC`}).format(new Date(`${e}T00:00:00Z`))}var P=S(`<meta name="description"/>`),F=S(`<link rel="icon" type="image/svg+xml"/> <!>`,1),I=S(`<a> </a>`),L=S(`<section class="release-column"><p class="release-month"> </p> <article class="release-document"><header><strong> </strong> <time> </time></header> <div class="release-downloads"><a><strong>macOS</strong><span>Download</span></a> <a><strong>Windows</strong><span>Download</span></a> <a><strong>Linux</strong><span>Download</span></a></div> <div class="release-copy"><p class="release-summary"> </p> <h2 class="release-title"> </h2> <div class="release-body"></div></div></article></section>`),R=S(`<section class="release-not-found"><p>Release not found</p> <h2>That version isn’t here.</h2> <a href="/releases/">View the latest release</a></section>`),z=S(`<header class="releases-header"><div class="releases-header-inner"><a class="releases-brand" href="/" aria-label="Polymux home"><img alt=""/><span>Polymux</span></a> <nav aria-label="Main navigation"><a href="/">Home</a> <!> <a href="/docs/">Docs</a> <a href="/blog/">Blog</a> <a class="active" href="/releases/">Releases</a></nav> <a class="releases-download" href="/#download">Download</a> <!></div></header> <main class="releases-page"><section class="releases-intro"><h1>Releases</h1> <p>See what’s new in each Polymux update.</p></section> <div class="releases-layout"><aside class="versions-sidebar"><p>Versions</p> <nav aria-label="Release versions"></nav></aside> <!></div></main> <footer class="releases-footer"><a class="releases-brand" href="/"><img alt=""/><span>Polymux</span></a> <span>Personal software, thoughtfully built.</span> <a href="/docs/">Docs</a> <a href="/privacy-policy/">Privacy</a></footer>`,1);function B(v,S){r(S,!1);let T=location.pathname.split(`/`).filter(Boolean),E=T[0]===`releases`&&T[1]?decodeURIComponent(T[1]):null,D=E?A(E):k[0],O=D?`https://github.com/CarlvinceTan/Polymux/releases/tag/v${encodeURIComponent(D.version)}`:`https://github.com/CarlvinceTan/Polymux/releases/latest`;h();var B=z();x(`yxu97l`,t=>{var r=F(),i=a(r),o=g(i,2),s=t=>{var r=P();l(()=>u(r,`content`,D.summary)),e(()=>{n.title=`Polymux ${D.version??``} Release Notes`}),p(t,r)};y(o,e=>{D&&e(s)}),l(()=>u(i,`href`,b)),p(t,r)});var V=a(B),H=t(V),U=t(H),W=t(U);i(),s(U);var G=g(U,2),K=g(t(G),2);w(K,{}),i(6),s(G);var q=g(G,4);C(q,{active:`releases`}),s(H),s(V);var J=g(V,2),Y=g(t(J),2),X=t(Y),Z=g(t(X),2);f(Z,5,()=>k,e=>e.version,(e,n)=>{var r=I();let i;var a=t(r,!0);s(r),l(e=>{u(r,`href`,e),i=_(r,1,``,null,i,{active:D?.version===c(n).version}),m(a,c(n).version)},[()=>j(c(n).version)]),p(e,r)}),s(Z),s(X);var ee=g(X,2),te=e=>{var n=L(),r=t(n),i=t(r,!0);s(r);var a=g(r,2),o=t(a),c=t(o),f=t(c,!0);s(c);var h=g(c,2),_=t(h,!0);s(h),s(o);var v=g(o,2),y=t(v),b=g(y,2),x=g(b,2);s(v);var S=g(v,2),C=t(S),w=t(C,!0);s(C);var T=g(C,2),E=t(T,!0);s(T);var k=g(T,2);d(k,()=>D.html,!0),s(k),s(S),s(a),s(n),l((e,t)=>{m(i,e),m(f,D.version),u(h,`datetime`,D.date),m(_,t),u(v,`aria-label`,`Download Polymux ${D.version}`),u(y,`href`,O),u(b,`href`,O),u(x,`href`,O),m(w,D.summary),m(E,D.title)},[()=>N(D.date),()=>M(D.date)]),p(e,n)},ne=e=>{var t=R();p(e,t)};y(ee,e=>{D?e(te):e(ne,-1)}),s(Y),s(J);var Q=g(J,2),$=t(Q),re=t($);i(),s($),i(6),s(Q),l(()=>{u(W,`src`,b),u(re,`src`,b)}),p(v,B),o()}v(B,{target:document.getElementById(`app`)});