<script lang="ts">
  import type {TeamAvatarDto} from '@polymux/protocol';

  export let avatar: TeamAvatarDto;
  export let name = '';
  export let size = 38;

  $: initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  $: colors = avatar.colorPair
    ? `--avatar-light:${avatar.colorPair.light};--avatar-dark:${avatar.colorPair.dark};`
    : `--avatar-light:${avatar.color};--avatar-dark:${avatar.color};`;
</script>

<div
  class="avatar avatar-{avatar.shape}"
  style={`${colors}--avatar-size:${size}px`}
  aria-label={`${name} avatar`}
  role="img"
>
  <span class="eye left"></span>
  <span class="eye right"></span>
  <span class="avatar-fallback">{initials}</span>
</div>

<style>
  .avatar {
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: 0 0 var(--avatar-size);
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--avatar-light);
    border-radius: 48% 52% 46% 54% / 52% 45% 55% 48%;
  }

  .avatar-square { border-radius: 27%; }
  .avatar-squircle { border-radius: 38% 31% 38% 32%; }
  .avatar-flower { border-radius: 42% 58% 36% 64% / 55% 37% 63% 45%; }
  .avatar-diamond { border-radius: 28%; transform: rotate(45deg) scale(.78); }
  .avatar-diamond > * { transform: rotate(-45deg); }
  .avatar-star { border-radius: 43% 57% 52% 48% / 62% 38% 62% 38%; }
  .avatar-burst { border-radius: 34% 66% 31% 69% / 62% 37% 63% 38%; }
  .avatar-blob { border-radius: 61% 39% 56% 44% / 43% 63% 37% 57%; }

  .eye {
    position: absolute;
    top: 38%;
    width: 4px;
    height: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--avatar-dark) 15%, #111 85%);
  }

  .eye.left { left: 34%; }
  .eye.right { right: 34%; }

  .avatar-fallback {
    opacity: 0;
    font-size: calc(var(--avatar-size) * .28);
    font-weight: 700;
    color: white;
  }

  @media (prefers-color-scheme: dark) {
    .avatar { background: var(--avatar-dark); }
    .eye { background: color-mix(in srgb, var(--avatar-light) 15%, #f5f5f5 85%); }
  }
</style>
