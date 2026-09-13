<script lang="ts">
  import type {ChatCallDto} from '@polymux/protocol';
  import {t} from '../../../i18n';
  import Icon from '../../shared/components/Icon.svelte';

  let {call}: {call: ChatCallDto} = $props();
  function duration(seconds: number): string {
    const value = Math.floor(seconds);
    const minutes = Math.floor(value / 60);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }
  const label = $derived(call.durationSeconds !== null
    ? $t('hub.callDuration', {duration: duration(call.durationSeconds)})
    : call.status === 'missed' ? $t('hub.callMissed')
    : call.status === 'declined' ? $t('hub.callDeclined')
    : call.status === 'cancelled' ? $t('hub.callCancelled')
    : call.status === 'incoming' ? $t('hub.callIncoming')
    : call.status === 'started' ? $t('hub.callStarted')
    : call.status === 'ended' ? $t('hub.callEnded')
    : $t(call.kind === 'video' ? 'hub.videoCall' : 'hub.voiceCall'));
</script>

<div class="hub-call-message" class:voice={call.kind === 'voice'} aria-label={`${$t(call.kind === 'video' ? 'hub.videoCall' : 'hub.voiceCall')}: ${label}`}>
  <Icon name={call.kind === 'video' ? 'video' : 'call'} size={call.kind === 'voice' ? 15 : 19} />
  <span>{label}</span>
</div>

<style>
  .hub-call-message { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; line-height: 1.45; }
  .hub-call-message :global(svg) { flex: 0 0 auto; }
  .hub-call-message.voice :global(svg) { transform: translateY(1px); }
  .hub-call-message span { min-width: 0; font-variant-numeric: tabular-nums; }
</style>
