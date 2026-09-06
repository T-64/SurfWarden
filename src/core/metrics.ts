import type { UsageRow } from './types';
import { dateKey } from '../shared/datetime';

/**
 * 报告指标（纯函数，IT3/v0.6.0）。全部基于 usage_daily 聚合表（不变量 3 保证其与明细一致），
 * 只有"小时分布"需要 sessions 明细。
 */

/** 最近 n 天的 dateKey 列表（含今天），旧→新 */
export function lastNDates(n: number, cutoffHour: number, now = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(dateKey(now - i * 86_400_000, cutoffHour));
  }
  return out;
}

/** 按日×类别聚合秒数：date → (categoryId → sec) */
export function aggregateByDate(rows: UsageRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let byCat = out.get(r.date);
    if (!byCat) {
      byCat = new Map();
      out.set(r.date, byCat);
    }
    byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) + r.seconds);
  }
  return out;
}

/** 按站点聚合秒数（用于 Top 站点），降序 */
export function aggregateByHost(rows: UsageRow[]): Array<{ host: string; seconds: number }> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.host, (m.get(r.host) ?? 0) + r.seconds);
  }
  return [...m.entries()].map(([host, seconds]) => ({ host, seconds })).sort((a, b) => b.seconds - a.seconds);
}

/** 学习 : 娱乐 比值；娱乐为 0 时返回 null（显示 ∞） */
export function learningToEntertainment(byCat: Map<string, number>): number | null {
  const l = byCat.get('learning') ?? 0;
  const e = byCat.get('entertainment') ?? 0;
  if (e === 0) return null;
  return Math.round((l / e) * 10) / 10;
}

/**
 * 学习 streak：连续"学习 ≥ minSec"的天数，从今天往回数；
 * 今天尚未达标不惩罚——从昨天开始数（今天还没过完）。
 */
export function learningStreak(
  rows: UsageRow[],
  minSec: number,
  cutoffHour: number,
  now = Date.now(),
): number {
  const byDate = aggregateByDate(rows);
  let streak = 0;
  let offset = 1; // 今天没达标不打断，从昨天起算
  for (;;) {
    const key = dateKey(now - offset * 86_400_000, cutoffHour);
    const sec = byDate.get(key)?.get('learning') ?? 0;
    if (sec >= minSec) {
      streak++;
      offset++;
    } else {
      break;
    }
  }
  // 今天已达标则再 +1
  const todayKeyStr = dateKey(now, cutoffHour);
  if ((byDate.get(todayKeyStr)?.get('learning') ?? 0) >= minSec) streak++;
  return streak;
}

/** 今日小时分布（近似：按段起始小时整段归桶），返回 24 个桶的秒数 */
export function hourBuckets(
  sessions: Array<{ start: number; end: number }>,
): number[] {
  const buckets: number[] = new Array<number>(24).fill(0);
  for (const s of sessions) {
    const sec = Math.max(0, Math.round((s.end - s.start) / 1000));
    if (sec === 0) continue;
    const h = new Date(s.start).getHours();
    buckets[h] = (buckets[h] ?? 0) + sec;
  }
  return buckets;
}

/** "今天 vs 7 日均值"比值（按总时长） */
export function todayVsWeekAvg(
  rows: UsageRow[],
  dates: string[],
  cutoffHour: number,
  now = Date.now(),
): number | null {
  const byDate = aggregateByDate(rows);
  const past = dates.slice(0, -1); // 不含今天
  if (past.length === 0) return null;
  const pastTotal = past.reduce((s, d) => {
    let day = 0;
    for (const v of byDate.get(d)?.values() ?? []) day += v;
    return s + day;
  }, 0);
  const avg = pastTotal / past.length;
  if (avg === 0) return null;
  const todayTotal = [...(byDate.get(dateKey(now, cutoffHour))?.values() ?? [])].reduce((a, b) => a + b, 0);
  return Math.round((todayTotal / avg) * 100) / 100;
}
