<script module lang="ts">
  export type Platform =
    | 'whatsapp' | 'telegram' | 'signal' | 'slack' | 'messenger' | 'instagram'
    | 'linkedin' | 'googlechat' | 'gmessages' | 'twitter' | 'bluesky' | 'gvoice'
    | 'zulip' | 'imessage' | 'wechat' | 'matrix' | 'mail';
</script>

<script lang="ts">
  import type {SimpleIcon} from 'simple-icons';
  import {
    siBluesky,
    siGooglechat,
    siGooglemessages,
    siImessage,
    siInstagram,
    siMatrix,
    siMessenger,
    siSignal,
    siTelegram,
    siWechat,
    siWhatsapp,
    siX,
    siZulip,
  } from 'simple-icons';

  type Mark = Pick<SimpleIcon, 'hex' | 'path'> & {rule?: 'evenodd'};

  export let platform: Platform;
  export let size = 20;
  export let mono = false;

  const linkedin: Mark = {
    hex: '0A66C2',
    path: 'M4.4 2.4a2.6 2.6 0 1 0 .01 0ZM2 8.9h4.8V22H2zM8.7 8.9h4.6v1.8c.8-1.3 2.3-2.2 4.2-2.2 3.1 0 5 2 5 5.7V22h-4.8v-6.8c0-1.8-.8-2.9-2.3-2.9-1.6 0-2.7 1.1-2.7 2.9V22H8.7z',
  };
  const mail: Mark = {
    hex: '0A5BD8',
    rule: 'evenodd',
    path: 'M4 4h16a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM3.6 5.5 12 12l8.4-6.5 1.4 1.8-9.1 7a1.3 1.3 0 0 1-1.6 0L2.2 7.3Z',
  };
  const slack: Mark = {
    hex: '611F69',
    path: 'M5.1 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1zm1 0a2.1 2.1 0 0 1 4.2 0v5.2a2.1 2.1 0 0 1-4.2 0zM8.2 6.9a2.1 2.1 0 1 1 2.1-2.1v2.1zm0 1.1a2.1 2.1 0 0 1 0 4.2H3a2.1 2.1 0 0 1 0-4.2zM16.8 10.1a2.1 2.1 0 1 1 2.1 2.1h-2.1zm-1.1 0a2.1 2.1 0 0 1-4.2 0V4.8a2.1 2.1 0 0 1 4.2 0zM13.6 18.4a2.1 2.1 0 1 1-2.1 2.1v-2.1zm0-1a2.1 2.1 0 0 1 0-4.2h5.3a2.1 2.1 0 0 1 0 4.2z',
  };
  const gvoice: Mark = {
    hex: '1A73E8',
    path: 'M12.6 1.7 22.3 11.4a1.9 1.9 0 0 1 0 2.7l-8.2 8.2a1.9 1.9 0 0 1-2.7 0L1.7 12.6a1.9 1.9 0 0 1 0-2.7l8.2-8.2a1.9 1.9 0 0 1 2.7 0M9.4 7.2a1 1 0 0 0-1.4 0l-1 1a1.4 1.4 0 0 0-.2 1.7 15 15 0 0 0 5.9 5.9 1.4 1.4 0 0 0 1.7-.2l1-1a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-.6.6a10 10 0 0 1-2.4-2.4l.6-.6a1 1 0 0 0 0-1.4z',
  };
  const marks: Record<Platform, Mark> = {
    whatsapp: siWhatsapp,
    telegram: siTelegram,
    signal: siSignal,
    slack,
    messenger: siMessenger,
    instagram: siInstagram,
    linkedin,
    googlechat: siGooglechat,
    gmessages: siGooglemessages,
    twitter: siX,
    bluesky: siBluesky,
    gvoice,
    zulip: siZulip,
    imessage: siImessage,
    wechat: siWechat,
    matrix: {...siMatrix, hex: '2B3038'},
    mail,
  };
  $: mark = marks[platform];
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
  {#if mono}
    <path d={mark.path} fill="currentColor" fill-rule={mark.rule} transform="translate(12 12) scale(.88) translate(-12 -12)" />
  {:else}
    <rect x=".5" y=".5" width="23" height="23" rx="6" fill={`#${mark.hex}`} />
    <path d={mark.path} fill="#fff" fill-rule={mark.rule} transform="translate(12 12) scale(.58) translate(-12 -12)" />
  {/if}
</svg>
