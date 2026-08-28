<script lang="ts">
  type Provider = 'local' | 'network' | 'google-drive' | 'dropbox' | 'onedrive' | 's3';
  type Mark = {hex: string; path: string; rule?: 'evenodd'};
  type ColourMark = {
    tile: string;
    box: {width: number; height: number};
    paths: {d: string; fill: string}[];
  };

  interface Props {
    provider: Provider;
    size?: number;
  }

  let {provider, size = 20}: Props = $props();

  const googleDrive: ColourMark = {
    tile: 'FFFFFF',
    box: {width: 87.3, height: 78},
    paths: [
      {d: 'm6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z', fill: '#0066da'},
      {d: 'm43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z', fill: '#00ac47'},
      {d: 'm73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z', fill: '#ea4335'},
      {d: 'm43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z', fill: '#00832d'},
      {d: 'm59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.4 4.5-1.2z', fill: '#2684fc'},
      {d: 'm73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z', fill: '#ffba00'},
    ],
  };

  const marks: Record<Exclude<Provider, 'google-drive'>, Mark> = {
    dropbox: {
      hex: '0061FF',
      path: 'M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z',
    },
    onedrive: {
      hex: '0078D4',
      path: 'M10.4 6.1a5.6 5.6 0 0 1 5.4 4.1 4.1 4.1 0 0 1 1-.1 4 4 0 0 1 .1 8H6.4a4.6 4.6 0 0 1-.8-9.1 5.6 5.6 0 0 1 4.8-2.9Z',
    },
    s3: {
      hex: '569A31',
      rule: 'evenodd',
      path: 'M4.4 3h15.2l-1.5 17.5A1.7 1.7 0 0 1 16.4 22H7.6a1.7 1.7 0 0 1-1.7-1.5ZM6.6 7.4l.4 4.4h10l.4-4.4Z',
    },
    local: {
      hex: '52525B',
      rule: 'evenodd',
      path: 'M4.5 3.5H19.5A2 2 0 0 1 21.5 5.5V9A2 2 0 0 1 19.5 11H4.5A2 2 0 0 1 2.5 9V5.5A2 2 0 0 1 4.5 3.5ZM5 5H19A1 1 0 0 1 20 6V8.5A1 1 0 0 1 19 9.5H5A1 1 0 0 1 4 8.5V6A1 1 0 0 1 5 5ZM6.5 6.35A.9.9 0 1 1 6.5 8.15A.9.9 0 1 1 6.5 6.35ZM4.5 13H19.5A2 2 0 0 1 21.5 15V18.5A2 2 0 0 1 19.5 20.5H4.5A2 2 0 0 1 2.5 18.5V15A2 2 0 0 1 4.5 13ZM5 14.5H19A1 1 0 0 1 20 15.5V18A1 1 0 0 1 19 19H5A1 1 0 0 1 4 18V15.5A1 1 0 0 1 5 14.5ZM6.5 15.85A.9.9 0 1 1 6.5 17.65A.9.9 0 1 1 6.5 15.85Z',
    },
    network: {
      hex: '52525B',
      rule: 'evenodd',
      path: 'M12 1.9A10.1 10.1 0 1 0 12 22.1A10.1 10.1 0 1 0 12 1.9ZM12 3.5A8.5 8.5 0 1 1 12 20.5A8.5 8.5 0 1 1 12 3.5ZM2.9 8.6H21.1V10.1H2.9ZM2.9 13.9H21.1V15.4H2.9ZM12 2.2C14.6 4.6 15.9 8.1 15.9 12C15.9 15.9 14.6 19.4 12 21.8C9.4 19.4 8.1 15.9 8.1 12C8.1 8.1 9.4 4.6 12 2.2ZM12 4.6C10.4 6.6 9.6 9.2 9.6 12C9.6 14.8 10.4 17.4 12 19.4C13.6 17.4 14.4 14.8 14.4 12C14.4 9.2 13.6 6.6 12 4.6Z',
    },
  };

  const inset = 'translate(12 12) scale(.58) translate(-12 -12)';
  let mark = $derived(provider === 'google-drive' ? googleDrive : marks[provider]);

  function isColour(value: Mark | ColourMark): value is ColourMark {
    return 'paths' in value;
  }

  function fit(box: {width: number; height: number}): string {
    const scale = 24 / Math.max(box.width, box.height);
    return `translate(${(24 - box.width * scale) / 2} ${(24 - box.height * scale) / 2}) scale(${scale})`;
  }
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
  {#if isColour(mark)}
    <rect x=".5" y=".5" width="23" height="23" rx="6" fill="#{mark.tile}" />
    <g transform={`${inset} ${fit(mark.box)}`}>
      {#each mark.paths as segment (segment.d)}
        <path d={segment.d} fill={segment.fill} />
      {/each}
    </g>
  {:else}
    <rect x=".5" y=".5" width="23" height="23" rx="6" fill="#{mark.hex}" />
    <path d={mark.path} fill="#fff" fill-rule={mark.rule} transform={inset} />
  {/if}
</svg>
