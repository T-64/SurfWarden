import type { MinuteOfDay, Phase, Schedule } from './types';

/**
 * 作息时段（纯函数，本地时区）。区间一律左闭右开，可跨午夜：
 * curfew = [bedtime, wake)，winddown = [windDown, bedtime)，其余为 day。
 * 两者重叠时 curfew 优先。
 */

export function minuteOf(ts: number): MinuteOfDay {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

function inRange(m: number, a: number, b: number): boolean {
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

export function phaseAt(ts: number, s: Schedule): Phase {
  const m = minuteOf(ts);
  if (inRange(m, s.bedtime, s.wake)) return 'curfew';
  if (inRange(m, s.windDown, s.bedtime)) return 'winddown';
  return 'day';
}

/** ts 之后（严格大于）最近一次本地时刻 minute:00 */
export function nextOccurrence(ts: number, minute: MinuteOfDay): number {
  const d = new Date(ts);
  for (let add = 0; add <= 2; add++) {
    const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, Math.floor(minute / 60), minute % 60, 0, 0).getTime();
    if (cand > ts) return cand;
  }
  return ts + 86_400_000;
}

/** ts 之前（含）最近一次本地时刻 minute:00 */
export function lastOccurrence(ts: number, minute: MinuteOfDay): number {
  const d = new Date(ts);
  for (let add = 0; add >= -2; add--) {
    const cand = new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, Math.floor(minute / 60), minute % 60, 0, 0).getTime();
    if (cand <= ts) return cand;
  }
  return ts - 86_400_000;
}

/** 下一次时段切换的时刻（用于闹钟与倒计时） */
export function nextPhaseChange(ts: number, s: Schedule): number {
  return Math.min(nextOccurrence(ts, s.windDown), nextOccurrence(ts, s.bedtime), nextOccurrence(ts, s.wake));
}

export function parseHHMM(text: string): MinuteOfDay | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatHHMM(minute: MinuteOfDay): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** 本地时间戳 → 'HH:MM' */
export function clockOf(ts: number): string {
  return formatHHMM(minuteOf(ts));
}
