<script lang="ts">
  import PromptInput from './PromptInput.svelte';
  export let greeting = 'What can I help with?';
  export let subtitle = 'Ask a question, attach a file, or start with your voice.';
  export let placeholder = 'Ask anything';
  export let active = false;
  export let onSend: (text: string, files: File[]) => void = () => {};
  export let onStop: () => void = () => {};
  export let onVoice: () => void = () => {};
  export let onOptions: () => void = () => {};
</script>

<section class="welcome-chat-pane">
  <div class="welcome-content">
    <img src="/polymux.svg" alt="Polymux" />
    <h1>{greeting}</h1>
    <p>{subtitle}</p>
    <div class="welcome-composer">
      <PromptInput variant="welcome" {active} {placeholder} onSend={onSend} onStop={onStop} onVoice={onVoice} onOptions={onOptions}/>
    </div>
  </div>
</section>

<style>
  .welcome-chat-pane { min-height: 0; flex: 1; display: grid; place-items: center; overflow-y: auto; padding: 62px 24px 90px; background: #fff; }
  .welcome-content { width: min(100%, 720px); display: flex; flex-direction: column; align-items: center; text-align: center; }
  img { width: 68px; height: 56px; object-fit: contain; margin-bottom: 25px; }
  h1 { margin: 0; color: #171717; font-size: clamp(27px, 4vw, 38px); font-weight: 560; letter-spacing: -.035em; }
  p { margin: 11px 0 30px; color: #737373; font-size: 14px; }
  .welcome-composer { width: 100%; text-align: left; }
  @media (max-width: 600px) { .welcome-chat-pane { align-items: start; padding: 85px 16px 40px; } img { width: 58px; } }
</style>
