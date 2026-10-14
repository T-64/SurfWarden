/** 显示格式（popup / report / options 共用） */

/** 秒 → "1 小时 5 分" / "12 分钟" / "<1 分钟" */
export function formatMin(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? '<1 分钟' : '0 分钟';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

/** 毫秒 → "h:mm" */
export function clockHM(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** 毫秒 → "m:ss" */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 时间戳 → 本地 "HH:MM" */
export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
