<script lang="ts">
  import type {SimpleIcon} from 'simple-icons';
  import {siDropbox, siGoogledrive} from 'simple-icons';
  import type {DriveProviderId} from '@midas/protocol';

  interface Props {
    provider: DriveProviderId;
    size?: number;
    /**
     * Renders the bare brand mark instead of a rounded app tile. Used for the
     * badge that trails a filename, where a filled tile at 11px reads as a
     * blob rather than a logo.
     */
    plain?: boolean;
  }

  type Mark = Pick<SimpleIcon, 'hex' | 'path'> & {rule?: 'evenodd'};

  let {provider, size = 20, plain = false}: Props = $props();

  // OneDrive and S3 are absent from simple-icons v16 — both were pulled over
  // trademark, the same reason LinkedIn and Slack are hand-authored in
  // PlatformLogo. They are drawn here on the same full-bleed 24x24 grid.
  const onedrive: Mark = {
    hex: '0078D4',
    path: 'M10.4 6.1a5.6 5.6 0 0 1 5.4 4.1 4.1 4.1 0 0 1 1-.1 4 4 0 0 1 .1 8H6.4a4.6 4.6 0 0 1-.8-9.1 5.6 5.6 0 0 1 4.8-2.9Z',
  };
  const s3: Mark = {
    hex: '569A31',
    rule: 'evenodd',
    // A storage bucket: the tapered drum every S3 mark is built from.
    path: 'M4.4 3h15.2l-1.5 17.5A1.7 1.7 0 0 1 16.4 22H7.6a1.7 1.7 0 0 1-1.7-1.5ZM6.6 7.4l.4 4.4h10l.4-4.4Z',
  };
  // The local drive is not a brand, so it gets a device rather than a logo —
  // and it is drawn filled like the others so every mark shares one weight.
  const local: Mark = {
    hex: '52525B',
    rule: 'evenodd',
    path: 'M3.8 4h16.4a1.8 1.8 0 0 1 1.8 1.8v9.4a1.8 1.8 0 0 1-1.8 1.8h-6.4v2h3a1 1 0 0 1 0 2H7.2a1 1 0 0 1 0-2h3v-2H3.8A1.8 1.8 0 0 1 2 15.2V5.8A1.8 1.8 0 0 1 3.8 4Zm.2 2v9h16V6Z',
  };

  const MARKS: Record<DriveProviderId, Mark> = {
    'google-drive': siGoogledrive,
    dropbox: siDropbox,
    onedrive,
    s3,
    local,
  };

  // The marks run edge to edge, so the tile treatment insets them to roughly
  // the proportion an app icon uses — the same ratio PlatformLogo uses, so a
  // storage tile and a messaging tile sit at one optical weight.
  const INSET = 'translate(12 12) scale(.58) translate(-12 -12)';

  let mark = $derived(MARKS[provider]);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  focusable="false"
  data-drive-provider={provider}
>
  {#if plain}
    <path d={mark.path} fill="#{mark.hex}" fill-rule={mark.rule}/>
  {:else}
    <rect x=".5" y=".5" width="23" height="23" rx="6" fill="#{mark.hex}"/>
    <path d={mark.path} fill="#fff" fill-rule={mark.rule} transform={INSET}/>
  {/if}
</svg>
