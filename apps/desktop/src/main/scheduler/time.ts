import { nextCronRun, zonedEpoch, zonedParts, type ScheduleFrequencyDto, type ScheduleWeekday } from "@polymux/protocol";

/**
 * When a cadence next comes round. Kept apart from the scheduler itself
 * because this is the part with all the calendar arithmetic in it, and the
 * part worth testing without a clock, a store or an agent in the way.
 *
 * Everything here works in the frequency's own zone rather than the host's:
 * "every weekday at 08:00 in Asia/Singapore" has to survive the user carrying
 * the laptop somewhere else, and has to keep meaning 08:00 across a daylight
 * saving change rather than sliding by an hour.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Wall-clock fields of an instant, read in a given zone. */
interface Wall {
  year: number;
  month: number; // 0-based, as Date uses
  day: number;
  hour: number;
  minute: number;
}

const partsIn = zonedParts;

/** The instant at which a zone's clock reads the given wall time. */
export const epochForWallTime = zonedEpoch;

function timeOfDay(time: string): {hour: number; minute: number} {
  const [hour, minute] = time.split(":").map(Number);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.trunc(hour))) : 0,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.trunc(minute))) : 0,
  };
}

function intervalOf(frequency: ScheduleFrequencyDto): number {
  // The two shapes that do not repeat on a count of anything.
  if (frequency.kind === "once" || frequency.kind === "cron") return 1;
  return Math.max(1, Math.round(frequency.interval ?? 1));
}

/** Whole days between two dates, ignoring the clock — the unit a weekly or
 * daily interval counts in. */
function daysBetween(from: Wall, to: Wall): number {
  const a = Date.UTC(from.year, from.month, from.day);
  const b = Date.UTC(to.year, to.month, to.day);
  return Math.round((b - a) / DAY);
}

/** Months between two dates, for monthly and yearly intervals. */
function monthsBetween(from: Wall, to: Wall): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/**
 * The first firing strictly after `after`.
 *
 * `anchor` is what an interval above one counts from — the moment the schedule
 * was created. Without it "every 3 days" would have no phase and would land on
 * a different day depending on when the question was asked.
 *
 * Returns undefined when nothing is left: a one-off already past, or a day of
 * the month that no month in range has.
 */
export function nextRunAfter(
  frequency: ScheduleFrequencyDto,
  after: number,
  anchor: number,
): number | undefined {
  const zone = frequency.timeZone || localTimeZone();
  const interval = intervalOf(frequency);

  if (frequency.kind === "once") return frequency.at > after ? frequency.at : undefined;

  // Cron carries its own arithmetic, in the package the renderer shares, so
  // the preview under the field and the run the scheduler fires agree.
  if (frequency.kind === "cron")
    return nextCronRun(frequency.expression, after, zone) ?? undefined;

  if (frequency.kind === "hourly") {
    const minute = Math.min(59, Math.max(0, Math.round(frequency.minute ?? 0)));
    // Hours are a fixed span, so this one needs no calendar: step from the
    // anchor's minute-of-hour by whole interval hours.
    const base = Math.floor(anchor / HOUR) * HOUR + minute * 60_000;
    const steps = Math.max(0, Math.ceil((after - base) / (interval * HOUR)));
    const candidate = base + steps * interval * HOUR;
    return candidate > after ? candidate : candidate + interval * HOUR;
  }

  const {hour, minute} = timeOfDay(frequency.time);
  const anchorWall = partsIn(zone, anchor);
  const afterWall = partsIn(zone, after);

  if (frequency.kind === "daily" || frequency.kind === "weekly") {
    const days = frequency.kind === "weekly"
      ? [...new Set(frequency.days)].sort((a, b) => a - b)
      : null;
    // A weekly schedule with no day selected can never fire; the view stops
    // that happening, but stored data is not something to trust blindly.
    if (days && days.length === 0) return undefined;
    // A fortnightly cadence can skip a whole week, so the search window is the
    // interval itself plus one full week of day choices.
    const horizon = interval * 7 + 8;
    for (let step = 0; step <= horizon; step += 1) {
      const dayStart = Date.UTC(afterWall.year, afterWall.month, afterWall.day) + step * DAY;
      const date = new Date(dayStart);
      const wall = {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        hour,
        minute,
      };
      if (frequency.kind === "daily") {
        if (daysBetween(anchorWall, wall) % interval !== 0) continue;
      } else {
        if (!days!.includes(date.getUTCDay() as ScheduleWeekday)) continue;
        // Weeks are counted from the anchor's own week, so "every 2 weeks on
        // Tuesday" keeps the week it started in rather than the even ones.
        const weeksApart = Math.floor(
          (daysBetween(anchorWall, wall) + anchorWall.weekday) / 7,
        );
        if (weeksApart % interval !== 0) continue;
      }
      const candidate = epochForWallTime(zone, wall);
      if (candidate > after) return candidate;
    }
    return undefined;
  }

  if (frequency.kind === "monthly") {
    for (let step = 0; step <= interval * 12 + interval; step += 1) {
      const month = afterWall.month + step;
      const year = afterWall.year + Math.floor(month / 12);
      const normalised = ((month % 12) + 12) % 12;
      if (monthsBetween(anchorWall, {...anchorWall, year, month: normalised}) % interval !== 0)
        continue;
      // A 31st does not exist in every month. It is skipped rather than
      // clamped to the 30th: the user asked for a date, not for "month end".
      if (frequency.dayOfMonth > daysInMonth(year, normalised)) continue;
      const candidate = epochForWallTime(zone, {
        year,
        month: normalised,
        day: frequency.dayOfMonth,
        hour,
        minute,
      });
      if (candidate > after) return candidate;
    }
    return undefined;
  }

  for (let step = 0; step <= interval + 4; step += 1) {
    const year = afterWall.year + step;
    if ((year - anchorWall.year) % interval !== 0) continue;
    if (frequency.dayOfMonth > daysInMonth(year, frequency.month)) continue;
    const candidate = epochForWallTime(zone, {
      year,
      month: frequency.month,
      day: frequency.dayOfMonth,
      hour,
      minute,
    });
    if (candidate > after) return candidate;
  }
  return undefined;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
