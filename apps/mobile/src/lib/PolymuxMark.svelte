<script lang="ts">
  import appIconUrl from '../../src-tauri/icons/128x128.png';

  export let size = 42;
  export let label = 'Polymux';
  export let framed = true;
</script>

<span
  class:framed
  class="polymux-mark"
  style={`--mark-size:${size}px;--mark-radius:${Math.round(size * .27)}px`}
  role="img"
  aria-label={label}
>
  <img src={appIconUrl} alt="" aria-hidden="true" />
</span>

<style>
  .polymux-mark {
    width: var(--mark-size);
    height: var(--mark-size);
    flex: 0 0 var(--mark-size);
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--mark-radius);
    background: #fff;
  }

  .polymux-mark.framed {
    border: 1px solid rgba(0, 0, 0, .08);
  }

  img { width: 100%; height: 100%; display: block; object-fit: cover; }
</style>
