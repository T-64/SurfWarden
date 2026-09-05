import Dexie, { type Table } from 'dexie';
import type { ClosedSegment, ExemptRow, SessionRow, UsageRow } from '../core/types';
import { dateKey } from '../shared/datetime';

/**
 * 使用数据（IndexedDB）。schema 与 docs/design/data-model.md §2 对应：
 * sessions 明细（90 天清理，v0.3 接入清理任务）、usage_daily 聚合（复合主键 upsert 幂等）、
 * exempts 豁免记录（一天一行）。
 *
 * 扩展内所有页面与 SW 共享同一 IndexedDB，popup/dashboard 可直接查询。
 */

const db = new Dexie('SurfWardenDB') as Dexie & {
  sessions: Table<SessionRow, number>;
  usageDaily: Table<UsageRow, [string, string, string]>;
  exempts: Table<ExemptRow, string>;
};

db.version(1).stores({
  sessions: '++id, date, categoryId, host, start',
  usageDaily: '[date+categoryId+host], date',
  exempts: 'date',
});

/** 段入库：明细 + 聚合同事务，保证不变量 3（聚合 === 明细之和） */
export async function recordSegments(segments: ClosedSegment[]): Promise<void> {
  if (segments.length === 0) return;
  await db.transaction('rw', db.sessions, db.usageDaily, async () => {
    for (const seg of segments) {
      await db.sessions.add({ ...seg });
      const seconds = Math.round((seg.end - seg.start) / 1000);
      if (seconds <= 0) continue;
      const pk: [string, string, string] = [seg.date, seg.categoryId, seg.host];
      const existing = await db.usageDaily.get(pk);
      if (existing) {
        await db.usageDaily.update(pk, {
          seconds: existing.seconds + seconds,
          visits: existing.visits + 1,
        });
      } else {
        await db.usageDaily.add({
          date: seg.date,
          categoryId: seg.categoryId,
          host: seg.host,
          seconds,
          visits: 1,
        });
      }
    }
  });
}

export async function usageForDate(date: string): Promise<UsageRow[]> {
  return db.usageDaily.where('date').equals(date).toArray();
}

/** 当日豁免次数（无行 = 0） */
export async function exemptCountForDate(date: string): Promise<number> {
  const row = await db.exempts.get(date);
  return row?.count ?? 0;
}

/** 记一次豁免，返回新计数 */
export async function addExempt(date: string): Promise<number> {
  return db.transaction('rw', db.exempts, async () => {
    const row = await db.exempts.get(date);
    const count = (row?.count ?? 0) + 1;
    await db.exempts.put({ date, count });
    return count;
  });
}

/** 明细保留策略：清理 N 天前的 sessions（聚合保留），返回删除行数 */
export async function purgeSessionsOlderThan(days: number): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  return db.sessions.where('start').below(cutoff).delete();
}

export function todayKey(cutoffHour: number): string {
  return dateKey(Date.now(), cutoffHour);
}

export { db };
