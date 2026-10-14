import Dexie, { type Table } from 'dexie';
import type { DayRow, EventRow, EventType, Piece, SessionRow, UsageRow } from '../core/types';

/**
 * 使用数据（IndexedDB，architecture §6）。扩展内所有页面与 SW 共享同一库。
 * 不变量：usage = Σ sessions（同事务写入）；days.lastAt = 当日片段最大 end。
 */

class SurfDB extends Dexie {
  sessions!: Table<SessionRow, string>;
  usage!: Table<UsageRow, [string, string, string]>;
  days!: Table<DayRow, string>;
  events!: Table<EventRow, number>;

  constructor() {
    super('SurfWardenV3');
    this.version(1).stores({
      sessions: 'id, date, start',
      usage: '[date+category+host], date',
      days: 'date',
      events: '++id, date, type',
    });
  }
}

export const db = new SurfDB();

/** 片段入库：同一 segId|date 合并为一行（心跳每 30s 追加一片） */
export async function recordPieces(pieces: Piece[]): Promise<void> {
  if (pieces.length === 0) return;
  await db.transaction('rw', db.sessions, db.usage, db.days, async () => {
    for (const p of pieces) {
      const seconds = (p.end - p.start) / 1000;
      if (seconds <= 0) continue;
      const id = `${p.segId}|${p.date}`;
      const existing = await db.sessions.get(id);
      if (existing) {
        await db.sessions.update(id, { end: Math.max(existing.end, p.end), title: p.title ?? existing.title, channel: p.channel ?? existing.channel });
      } else {
        await db.sessions.add({ ...p, id });
      }

      const pk: [string, string, string] = [p.date, p.category, p.host];
      const u = await db.usage.get(pk);
      if (u) await db.usage.update(pk, { seconds: u.seconds + seconds });
      else await db.usage.add({ date: p.date, category: p.category, host: p.host, seconds });

      const d = await db.days.get(p.date);
      await db.days.put({
        date: p.date,
        firstAt: Math.min(d?.firstAt ?? p.start, p.start),
        lastAt: Math.max(d?.lastAt ?? p.end, p.end),
      });
    }
  });
}

export const usageFor = (dates: string[]) => db.usage.where('date').anyOf(dates).toArray();
export const sessionsFor = (date: string) => db.sessions.where('date').equals(date).toArray();
export const daysFor = (dates: string[]) => db.days.where('date').anyOf(dates).toArray();
export const eventsFor = (dates: string[]) => db.events.where('date').anyOf(dates).toArray();

export async function addEvent(e: Omit<EventRow, 'id'>): Promise<void> {
  await db.events.add(e);
}

export async function countEvents(dates: string[], type: EventType, sinceAt = 0): Promise<number> {
  return db.events
    .where('date')
    .anyOf(dates)
    .filter((e) => e.type === type && e.at >= sinceAt)
    .count();
}

/** 明细保留 90 天；聚合、作息、事件永久保留 */
export async function purgeSessionsOlderThan(days: number, now = Date.now()): Promise<number> {
  return db.sessions.where('start').below(now - days * 86_400_000).delete();
}

export async function exportAll() {
  const [sessions, usage, days, events] = await Promise.all([
    db.sessions.toArray(),
    db.usage.toArray(),
    db.days.toArray(),
    db.events.toArray(),
  ]);
  return { sessions, usage, days, events };
}

export async function clearAll(): Promise<void> {
  await Promise.all([db.sessions.clear(), db.usage.clear(), db.days.clear(), db.events.clear()]);
}
