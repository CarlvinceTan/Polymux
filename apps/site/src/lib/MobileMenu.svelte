<script lang="ts">
  import {onMount} from 'svelte';
  import github from 'simple-icons/icons/github.svg?url';
  import DownloadIcon from './DownloadIcon.svelte';

  type Section = 'home' | 'docs' | 'releases';

  let {active, downloadHref = '/#download'}: {active?: Section; downloadHref?: string} = $props();
  let open = $state(false);
  let menuRoot: HTMLDivElement;

  const links: {id: Section; label: string; href: string}[] = [
    {id: 'home', label: 'Home', href: '/'},
    {id: 'docs', label: 'Docs', href: '/docs/'},
    {id: 'releases', label: 'Releases', href: '/releases/'},
  ];

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

<div class="mobile-menu" class:open bind:this={menuRoot}>
  <button
    class="mobile-menu-toggle"
    type="button"
    aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
    aria-expanded={open}
    aria-controls="mobile-navigation-drawer"
    onclick={() => open = !open}
  >
    {#if open}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16" /></svg>
    {:else}
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
    {/if}
  </button>

  <div id="mobile-navigation-drawer" class="mobile-menu-drawer" aria-hidden={!open} inert={!open}>
    <div class="mobile-menu-links" role="navigation" aria-label="Mobile navigation">
      {#each links as link (link.id)}
        <a
          class:current={link.id === active}
          href={link.href}
          aria-current={link.id === active ? 'page' : undefined}
          onclick={() => open = false}
        >{link.label}</a>
      {/each}
    </div>
    <div class="mobile-menu-actions">
      <a class="mobile-menu-download" href={downloadHref} onclick={() => open = false}>
        <DownloadIcon />
        <span>Download</span>
      </a>
      <a class="mobile-menu-github" href="https://github.com/CarlvinceTan/Polymux" onclick={() => open = false}>
        <img src={github} alt="" />
        <span>GitHub</span>
      </a>
    </div>
  </div>
</div>

<style>
  .mobile-menu{position:relative;display:none;margin-left:auto;color:#171717}.mobile-menu-toggle{width:40px;height:40px;padding:10px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;cursor:pointer;font-family:inherit}.mobile-menu-toggle svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}
  .mobile-menu-drawer{position:absolute;top:calc(100% + 10px);right:0;width:min(208px,calc(100vw - 28px));max-height:calc(100vh - 78px);padding:6px;overflow:auto;border:1px solid #d8d8d3;border-radius:8px;background:#fbfbf9;box-shadow:0 14px 40px rgba(0,0,0,.14);opacity:0;visibility:hidden;pointer-events:none;transform:translateX(6px);transition:opacity 160ms ease,transform 180ms cubic-bezier(.45,0,.55,1),visibility 160ms ease;scrollbar-width:none}.mobile-menu-drawer::-webkit-scrollbar{display:none}.open .mobile-menu-drawer{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(0)}.mobile-menu-links{display:flex;align-items:stretch;flex-direction:column;gap:1px;color:#666661}.mobile-menu-links a,.mobile-menu-actions a{min-height:36px;padding:0 9px;display:flex;align-items:center;border-radius:6px;font-size:13px;font-weight:600;line-height:1;transition:background 140ms ease,color 140ms ease}.mobile-menu-links a:hover,.mobile-menu-links a.current,.mobile-menu-github:hover{color:#171717;background:#efefeb}.mobile-menu-links a.current{font-weight:700}.mobile-menu-actions{margin-top:6px;padding-top:6px;display:flex;flex-direction:column;gap:1px;border-top:1px solid #deded9}.mobile-menu-actions a{gap:7px}.mobile-menu-download{color:#fff;background:#171717}.mobile-menu-download:hover{opacity:.84}.mobile-menu-download :global(.download-icon){width:15px;height:15px;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.mobile-menu-github{color:#555550}.mobile-menu-github img{width:15px;height:15px;opacity:.78}
  @media(max-width:1050px){.mobile-menu{display:block}}
</style>
