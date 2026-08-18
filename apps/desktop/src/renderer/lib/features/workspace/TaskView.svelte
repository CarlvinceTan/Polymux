<script lang="ts">
  import Message from '../chat/Message.svelte';
  import AgentActivity from '../chat/AgentActivity.svelte';
  import {scrollFade} from '../../shared/scrollFade';
  import {taskStatusLabel, type TaskStatus} from './taskStatus';
  import TaskGlyph from '../../shared/components/TaskGlyph.svelte';
  import type {TaskTranscript} from './taskTranscript';
  import {t} from '../../../i18n';

  export let title = '';
  /** The task row's id, so the tab carries the same mark the row does. */
  export let taskId = '';
  export let status: TaskStatus = 'active';
  export let transcript: TaskTranscript | null = null;
  export let onOpenLink: (url: string, title: string) => void = () => {};
  export let onOpenFilePath: (path: string) => void = () => {};

  $: running = status === 'active' || status === 'pending';
  $: activityVisible = Boolean(transcript?.activities.length || running);
</script>

<!-- The delegated run as it happened, and nothing more: the subagent answers to
     the run that sent it, so this reads rather than replies. No composer, no
     edit, no feedback — every control here would be addressed to nobody. -->
<section class="task-view" aria-label={title || $t('view.task')}>
  <header class="task-view-header">
    <TaskGlyph id={taskId} {status} size={17}/>
    <strong>{title || $t('activity.delegatedTask')}</strong>
    <span class="task-view-status">{taskStatusLabel(status)}</span>
  </header>

  <div class="task-view-body" use:scrollFade={transcript} aria-live="polite">
    {#if transcript}
      {#if transcript.prompt}
        <Message message={{id: `${transcript.runId}:prompt`, role: 'user', text: transcript.prompt}} readOnly {onOpenLink} {onOpenFilePath}/>
      {/if}
      {#if activityVisible}
        <AgentActivity
          activities={transcript.activities}
          startedAt={transcript.startedAt}
          completedAt={transcript.completedAt}
          streaming={running}
        />
      {/if}
      <Message
        message={{id: `${transcript.runId}:result`, role: 'assistant', text: transcript.text}}
        streaming={running}
        {activityVisible}
        readOnly
        {onOpenLink}
        {onOpenFilePath}
      />
    {:else}
      <p class="task-view-empty">{$t('view.taskEmpty')}</p>
    {/if}
  </div>
</section>
