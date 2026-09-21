import type {JsonValue} from '@polymux/protocol';
import {required, scheduleInput, schedulePatch} from '../backend/requests.js';
import type {Scheduler} from './index.js';

export const SCHEDULE_HOST_METHODS = [
  'schedules.list', 'schedules.create', 'schedules.update', 'schedules.remove',
  'schedules.markRead', 'schedules.runNow',
] as const;

export function scheduleHostCall(scheduler: Scheduler, method: string, args: JsonValue[], requireBot: (id: string) => void): JsonValue {
  let result: unknown;
  switch (method) {
    case 'schedules.list': result = scheduler.list(); break;
    case 'schedules.create': {
      const input = scheduleInput(args[0]);
      if (input.botId) requireBot(input.botId);
      result = scheduler.create(input); break;
    }
    case 'schedules.update': result = scheduler.update(required(args[0], 'Schedule'), schedulePatch(args[1])); break;
    case 'schedules.remove': scheduler.remove(required(args[0], 'Schedule')); result = null; break;
    case 'schedules.markRead': result = scheduler.markRead(required(args[0], 'Schedule')); break;
    case 'schedules.runNow': result = scheduler.runNow(required(args[0], 'Schedule')); break;
    default: throw new Error('Unknown schedule action');
  }
  return result as JsonValue;
}
