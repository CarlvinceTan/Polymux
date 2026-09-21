<script lang="ts">
  import type {TeamAvatarDto, TeamAvatarExpression} from '@polymux/protocol';
  import BloubAvatar from './BloubAvatar.svelte';
  import type {BloubActivity} from './bloub/expression';
  import type {BloubTheme} from './bloub/colors';

  export let avatar: TeamAvatarDto;
  export let expression: TeamAvatarExpression = 'neutral';
  export let activity: BloubActivity = 'idle';
  export let size = 32;
  export let centerSilhouette = false;
  export let label = '';
  export let animated = true;
  export let monochrome = false;
  export let paper = 'var(--app-bg)';
  export let theme: BloubTheme | null = null;
</script>

<BloubAvatar {avatar} {expression} {activity} {size} {centerSilhouette} {label} {animated} {monochrome} {paper} {theme}/>
