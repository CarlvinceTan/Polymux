<script lang="ts">
  import {onMount} from 'svelte';
  import FeatureIcon from './FeatureIcon.svelte';
  import {agentFeatures, appFeatures, productFeaturePath} from './productFeatures';

  let {active = false}: {active?: boolean} = $props();
  let open = $state(false);
  let menuRoot: HTMLDivElement;

  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (open && !event.composedPath().includes(menuRoot)) open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') open = false;
    };
    window.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div
  class:open
  class:active
  class="product-menu"
  role="group"
  aria-label="Product navigation"
  bind:this={menuRoot}
>
  <button type="button" aria-expanded={open} aria-controls="product-menu-panel" onclick={() => open = !open}>
    <span>Product</span>
  </button>

  {#if open}<button class="product-dismiss" type="button" tabindex="-1" aria-label="Close product menu" onclick={() => open = false}></button>{/if}
  <div id="product-menu-panel" class="product-panel" aria-hidden={!open}>
    <section>
      <p>App features</p>
      <div class="product-links">
        {#each appFeatures as feature (feature.slug)}
          <a href={productFeaturePath(feature.slug)} onclick={() => open = false}>
            <FeatureIcon name={feature.icon} />
            <span><strong>{feature.name}</strong><small>{feature.menuDescription}</small></span>
          </a>
        {/each}
      </div>
    </section>
    <section>
      <p>Agent features</p>
      <div class="product-links">
        {#each agentFeatures as feature (feature.slug)}
          <a href={productFeaturePath(feature.slug)} onclick={() => open = false}>
            <FeatureIcon name={feature.icon} />
            <span><strong>{feature.name}</strong><small>{feature.menuDescription}</small></span>
          </a>
        {/each}
      </div>
    </section>
    <a class="product-overview-link" href="/product/" onclick={() => open = false}>Explore all product features <span aria-hidden="true">→</span></a>
  </div>
</div>

<style>
  .product-menu{position:relative;display:flex;align-items:center;color:#969691;font:inherit}.product-menu>button{min-height:36px;padding:8px 12px;display:inline-flex;align-items:center;border:0;background:transparent;color:inherit;font:inherit;line-height:20px;cursor:pointer;transition:color 140ms ease}.product-menu>button:hover,.product-menu.open>button,.product-menu.active>button{color:var(--ink,#171717)}.product-menu.active>button:after{content:"";position:absolute;right:12px;bottom:4px;left:12px;height:2px;background:var(--ink,#171717)}
  .product-dismiss{position:fixed;inset:68px 0 0;z-index:0;border:0;background:transparent;cursor:default}.product-panel{position:absolute;z-index:1;top:calc(100% + 8px);left:0;width:min(760px,calc(100vw - 40px));display:grid;grid-template-columns:1fr 1fr;padding:22px 22px 54px;border:1px solid #d8d8d3;border-radius:10px;background:#fbfbf9;box-shadow:0 22px 60px rgba(0,0,0,.14);color:#171717;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-5px);transition:opacity 140ms ease,transform 140ms ease,visibility 140ms ease}.open .product-panel{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0)}.product-panel>section{min-width:0;padding:0 18px}.product-panel>section+section{border-left:1px solid #e1e1dc}.product-panel>section>p{margin:4px 0 12px;color:#8d8d88;font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.product-links{display:flex;flex-direction:column;gap:3px}.product-links a{min-width:0;padding:11px 9px;display:grid;grid-template-columns:22px minmax(0,1fr);align-items:start;gap:10px;border-radius:7px;transition:background 140ms ease}.product-links a:hover{background:#efefeb}.product-links :global(.feature-icon){width:19px;height:19px;margin-top:1px;stroke:#555550;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}.product-links span{min-width:0;display:flex;flex-direction:column;gap:4px}.product-links strong{font-size:14px;font-weight:650;line-height:1.2}.product-links small{overflow:hidden;color:#7b7b76;font-size:11px;font-weight:450;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}.product-overview-link{position:absolute;right:31px;bottom:18px;display:inline-flex;align-items:center;gap:7px;color:#6f6f6b;font-size:11px;font-weight:600}.product-overview-link:hover{color:#171717}.product-overview-link span{transition:transform 140ms ease}.product-overview-link:hover span{transform:translateX(3px)}
  @media(max-width:760px){.product-menu>button{padding:8px 7px}.product-dismiss{inset:60px 0 0}.product-panel{position:fixed;top:60px;right:14px;left:14px;width:auto;max-height:calc(100vh - 74px);grid-template-columns:1fr;padding:16px 14px 50px;overflow:auto;transform:translateY(-4px);scrollbar-width:none}.product-panel::-webkit-scrollbar{display:none}.open .product-panel{transform:translateY(0)}.product-panel>section{padding:0}.product-panel>section+section{margin-top:12px;padding-top:15px;border-top:1px solid #e1e1dc;border-left:0}.product-links{display:grid;grid-template-columns:1fr 1fr;gap:3px}.product-links a{padding:9px 7px;grid-template-columns:19px minmax(0,1fr);gap:8px}.product-links :global(.feature-icon){width:17px;height:17px}.product-links strong{font-size:12px}.product-links small{font-size:10px}.product-overview-link{right:22px;bottom:17px}}
</style>
