<script lang="ts">
  import {iconPaths, type IconName} from './icons';

  export let name: IconName;
  export let size = 22;
  export let strokeWidth = 1.8;
  export let viewBox = '0 0 24 24';
  export let label = '';
</script>

<svg
  width={size}
  height={size}
  {viewBox}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  aria-label={label || undefined}
>
  {#each iconPaths[name] as path}
    <path d={path}></path>
  {/each}
</svg>
