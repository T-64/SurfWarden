/** 时长格式化（popup / guide 共用） */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? '<1 分钟' : '0';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}
