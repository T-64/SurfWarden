import { dayRange, logicalDayAt } from '../shared/datetime';
import { siteKey } from './classify';
import type { CategoryId, DayRow, EventRow, Schedule, SessionRow, UsageRow } from './types';

/** 报告指标（纯函数）。输入是 db 原始行，输出是报告页直接可画的结构。 */

export type CategoryTotals = Record<CategoryId, number>;

export function emptyTotals(): CategoryTotals {
  return { german: 0, study: 0, drift: 0, other: 0 };
}

export function totalsByCategory(rows: UsageRow[]): CategoryTotals {
  const t = emptyTotals();
  for (const r of rows) t[r.category] += r.seconds;
  return t;
}

/** date → 类别秒数 */
export function totalsByDate(rows: UsageRow[]): Map<string, CategoryTotals> {
  const out = new Map<string, CategoryTotals>();
  for (const r of rows) {
    let t = out.get(r.date);
    if (!t) out.set(r.date, (t = emptyTotals()));
    t[r.category] += r.seconds;
  }
  return out;
}

export function topHosts(rows: UsageRow[], n: number): Array<{ host: string; seconds: number; category: CategoryId }> {
  const m = new Map<string, { seconds: number; byCat: CategoryTotals }>();
  for (const r of rows) {
    const host = r.host.replace(/^www\./, '');
    let e = m.get(host);
    if (!e) m.set(host, (e = { seconds: 0, byCat: emptyTotals() }));
    e.seconds += r.seconds;
    e.byCat[r.category] += r.seconds;
  }
  return [...m.entries()]
    .map(([host, e]) => ({ host, seconds: e.seconds, category: dominant(e.byCat) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, n);
}

function dominant(t: CategoryTotals): CategoryId {
  return (Object.entries(t) as Array<[CategoryId, number]>).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/**
 * 连续达标天数：从昨天往回数"德语 ≥ goal"的天，今天已达标再 +1
 * （今天还没过完，未达标不打断）。
 */
export function germanStreak(byDate: Map<string, CategoryTotals>, dates: string[], goalSec: number): number {
  if (dates.length === 0 || goalSec <= 0) return 0;
  const met = (d: string) => (byDate.get(d)?.german ?? 0) >= goalSec;
  let streak = 0;
  for (let i = dates.length - 2; i >= 0 && met(dates[i]!); i--) streak++;
  if (met(dates[dates.length - 1]!)) streak++;
  return streak;
}

export interface NightStat {
  date: string;
  /** 当晚最后活动时刻；无数据为 null */
  lastAt: number | null;
  bedtimeAt: number;
  /** 相对就寝时刻的分钟数，正 = 晚于就寝 */
  lateMin: number | null;
  /** 次日逻辑日的首次活动 */
  firstNextAt: number | null;
  wakeAt: number;
}

/** 作息：逻辑日 date 晚上的最后上网 vs 就寝；次日首次上网 vs 起床 */
export function nightStats(days: DayRow[], dates: string[], schedule: Schedule, cutoffHour: number): NightStat[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return dates.map((date, idx) => {
    const row = byDate.get(date);
    const bedtimeAt = logicalDayAt(date, schedule.bedtime, cutoffHour);
    const next = dates[idx + 1];
    const nextRow = next ? byDate.get(next) : undefined;
    const wakeAt = next ? logicalDayAt(next, schedule.wake, cutoffHour) : NaN;
    return {
      date,
      lastAt: row?.lastAt ?? null,
      bedtimeAt,
      lateMin: row ? Math.round((row.lastAt - bedtimeAt) / 60_000) : null,
      firstNextAt: nextRow?.firstAt ?? null,
      wakeAt,
    };
  });
}

export interface TimelineBlock {
  /** 0–1：在逻辑日 [cutoff, 次日 cutoff) 中的位置 */
  from: number;
  to: number;
  category: CategoryId;
  host: string;
}

/** 24h 时间线：相邻同类块（间隔 ≤ 2 分钟）合并 */
export function timeline(sessions: SessionRow[], date: string, cutoffHour: number): TimelineBlock[] {
  const [start, end] = dayRange(date, cutoffHour);
  const span = end - start;
  const sorted = sessions.filter((s) => s.date === date).sort((a, b) => a.start - b.start);
  const out: TimelineBlock[] = [];
  for (const s of sorted) {
    const from = (s.start - start) / span;
    const to = (s.end - start) / span;
    const last = out[out.length - 1];
    if (last && last.category === s.category && from - last.to <= 120_000 / span) {
      last.to = Math.max(last.to, to);
    } else {
      out.push({ from, to, category: s.category, host: s.host });
    }
  }
  return out;
}

export interface IntentEntry {
  at: number;
  site: string;
  intent: string;
  minutes: number;
}

export interface SiteIntentSummary {
  site: string;
  /** 申请到的分钟总和 */
  grantedMin: number;
  /** 该站点当天实际娱乐分钟 */
  actualMin: number;
  entries: IntentEntry[];
}

/** 意图日志："说要看多久"vs"实际看了多久"（按站点汇总） */
export function intentSummary(events: EventRow[], usage: UsageRow[]): SiteIntentSummary[] {
  const actual = new Map<string, number>();
  for (const r of usage) {
    if (r.category !== 'drift') continue;
    const k = siteKey(r.host);
    actual.set(k, (actual.get(k) ?? 0) + r.seconds);
  }
  const bySite = new Map<string, SiteIntentSummary>();
  for (const e of events) {
    if (e.type !== 'pass' || !e.site) continue;
    let s = bySite.get(e.site);
    if (!s) bySite.set(e.site, (s = { site: e.site, grantedMin: 0, actualMin: 0, entries: [] }));
    s.grantedMin += e.minutes ?? 0;
    s.entries.push({ at: e.at, site: e.site, intent: e.intent ?? '', minutes: e.minutes ?? 0 });
  }
  // 没申请过却有娱乐时长的站点（例如闸门前的几秒、宵禁延长中）也列出
  for (const [site, sec] of actual) {
    if (!bySite.has(site) && sec >= 60) bySite.set(site, { site, grantedMin: 0, actualMin: 0, entries: [] });
  }
  for (const s of bySite.values()) s.actualMin = Math.round((actual.get(s.site) ?? 0) / 60);
  return [...bySite.values()].sort((a, b) => b.actualMin - a.actualMin);
}
