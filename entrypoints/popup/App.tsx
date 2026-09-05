import { useEffect, useState } from 'react';
import { configStore } from '../../src/adapters/configStore';
import { todayKey, usageForDate } from '../../src/adapters/db';
import type { Category, UsageRow } from '../../src/core/types';

export function formatDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? '<1 分钟' : '0';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

export function App() {
  const [cats, setCats] = useState<Category[]>([]);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    void (async () => {
      const settings = await configStore.getSettings();
      const [cats, rows] = await Promise.all([
        configStore.getCategories(),
        usageForDate(todayKey(settings.dayCutoffHour)),
      ]);
      const sorted = [...rows].sort((a, b) => b.seconds - a.seconds);
      setCats(cats);
      setRows(sorted);
      setTotal(sorted.reduce((s, r) => s + r.seconds, 0));
    })();
  }, []);

  const catById = new Map(cats.map((c) => [c.id, c]));
  const byCategory = new Map<string, number>();
  for (const r of rows ?? []) {
    byCategory.set(r.categoryId, (byCategory.get(r.categoryId) ?? 0) + r.seconds);
  }

  return (
    <div className="app">
      <header>
        <h1>SurfWarden</h1>
        <span className="sub">今日 · 共 {formatDuration(total)}</span>
      </header>

      {rows === null ? (
        <p className="empty">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="empty">今天还没有记录。打开几个网页后再回来看。</p>
      ) : (
        <>
          <ul className="cats">
            {cats
              .filter((c) => (byCategory.get(c.id) ?? 0) > 0)
              .map((c) => (
                <li key={c.id}>
                  <span className="dot" style={{ background: c.color }} />
                  <span className="name">{c.name}</span>
                  <span className="time">{formatDuration(byCategory.get(c.id) ?? 0)}</span>
                </li>
              ))}
          </ul>
          <h2>Top 站点</h2>
          <ul className="hosts">
            {(rows ?? []).slice(0, 5).map((r) => (
              <li key={`${r.categoryId}-${r.host}`}>
                <span className="name">{r.host}</span>
                <span className="time">{formatDuration(r.seconds)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <footer>v0.1 · 数据仅存本机</footer>
    </div>
  );
}
