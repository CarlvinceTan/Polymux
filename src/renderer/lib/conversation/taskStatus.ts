export type TaskStatus = 'pending' | 'active' | 'completed' | 'failed';
export type TaskTone = 'running' | 'done' | 'failed';

/**
 * Collapses task states into the three the Summary indicator shows: still
 * working, finished, or something went wrong.
 */
export function taskStatusTone(status: TaskStatus): TaskTone {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    default:
      return 'running';
  }
}

export function taskStatusLabel(status: TaskStatus): string {
  const tone = taskStatusTone(status);
  return tone === 'done' ? 'Completed' : tone === 'failed' ? 'Failed' : 'Working';
}
