/**
 * 逻辑日与跨天拆分（纯函数）。
 * "一天"由 dayCutoffHour 定义：cutoff=4 表示 04:00 才算新的一天，
 * 因此凌晨 02:00 属于前一天的逻辑日（PRODUCT.md §3.8）。
 */

const MS_HOUR = 3_600_000;

/** ts 所属逻辑日的 'YYYY-MM-DD'（本地时区） */
export function dateKey(ts: number, cutoffHour: number): string {
  const d = new Date(ts - cutoffHour * MS_HOUR);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ts 之后最近一次"逻辑日边界"（本地时间某日 cutoffHour:00:00.000）的时间戳 */
export function nextDayBoundary(ts: number, cutoffHour: number): number {
  const d = new Date(ts);
  for (let add = 0; add <= 1; add++) {
    const cand = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + add,
      cutoffHour,
      0,
      0,
      0,
    ).getTime();
    if (cand > ts) return cand;
  }
  return ts + MS_HOUR; // 不可达，兜底
}

export interface DayPiece {
  date: string;
  start: number;
  end: number;
}

/** 把 [start, end) 按逻辑日拆分；同日则单条 */
export function splitByDay(start: number, end: number, cutoffHour: number): DayPiece[] {
  const out: DayPiece[] = [];
  let cur = start;
  while (cur < end) {
    const boundary = nextDayBoundary(cur, cutoffHour);
    const pieceEnd = Math.min(end, boundary);
    out.push({ date: dateKey(cur, cutoffHour), start: cur, end: pieceEnd });
    cur = pieceEnd;
  }
  return out;
}

/** 'YYYY-MM-DD' 加减 n 个日历日（DST 安全） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** 逻辑日 date 的本地时刻 minute（minute < cutoff 时落在次日凌晨） */
export function logicalDayAt(date: string, minute: number, cutoffHour: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const extra = minute < cutoffHour * 60 ? 1 : 0;
  return new Date(y, m - 1, d + extra, Math.floor(minute / 60), minute % 60, 0, 0).getTime();
}

/** 逻辑日的 [起, 止) 时间戳 */
export function dayRange(date: string, cutoffHour: number): [number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return [new Date(y, m - 1, d, cutoffHour).getTime(), new Date(y, m - 1, d + 1, cutoffHour).getTime()];
}

/** 截至 today 的最近 n 个逻辑日（旧→新） */
export function lastNDates(today: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}
