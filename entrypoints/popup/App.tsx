import { useCallback, useEffect, useState } from 'react';
import { configStore } from '../../src/adapters/configStore';
import { todayKey, usageForDate } from '../../src/adapters/db';
import { usageByCategory } from '../../src/core/budget';
import type { Category, Settings, UsageRow } from '../../src/core/types';
import { formatDuration } from '../../src/shared/format';

interface CurrentInfo {
  url: string;
  host: string;
  categoryId: string;
  startedAt: number;
  incognito: boolean;
}

interface PopupData {
  cats: Category[];
  rows: UsageRow[];
  settings: Settings;
  current: CurrentInfo | null;
}

async function loadData(): Promise<PopupData> {
  const settings = await configStore.getSettings();
  const [cats, rows] = await Promise.all([
    configStore.getCategories(),
    usageForDate(todayKey(settings.dayCutoffHour)),
  ]);
  const res = await chrome.runtime.sendMessage({ type: 'sw-get-state' });
  return {
    cats,
    rows: [...rows].sort((a, b) => b.seconds - a.seconds),
    settings,
    current: (res?.current as CurrentInfo | null) ?? null,
  };
}

const R = 52;
const C = 2 * Math.PI * R;

export function App() {
  const [data, setData] = useState<PopupData | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void loadData().then(setData);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="app">加载中…</div>;
  const { cats, rows, settings, current } = data;
  const used = usageByCategory(rows);
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const present = cats.filter((c) => (used.get(c.id) ?? 0) > 0);
  const paused = settings.pauseUntil !== undefined && Date.now() < settings.pauseUntil;

  async function reclassify(categoryId: string): Promise<void> {
    setBusy(true);
    await chrome.runtime.sendMessage({ type: 'sw-reclassify', categoryId });
    refresh();
    setBusy(false);
  }

  async function pause30(): Promise<void> {
    setBusy(true);
    await configStore.saveSettings({
      ...settings,
      pauseUntil: Date.now() + 30 * 60_000,
    });
    refresh();
    setBusy(false);
  }

  // 环形图 arc 参数
  let acc = 0;
  const arcs = present.map((c) => {
    const frac = total > 0 ? (used.get(c.id) ?? 0) / total : 0;
    const arc = { c, frac, offset: acc };
    acc += frac;
    return arc;
  });

  return (
    <div className="app">
      <header>
        <h1>SurfWarden</h1>
        <span className="sub">今日 · 共 {formatDuration(total)}</span>
      </header>

      {total === 0 ? (
        <p className="empty">今天还没有记录。打开几个网页后再回来看。</p>
      ) : (
        <>
          <div className="ringrow">
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={R} fill="none" stroke="#f3f4f6" strokeWidth="14" />
              {arcs.map(({ c, frac, offset }) => (
                <circle
                  key={c.id}
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke={c.color}
                  strokeWidth="14"
                  strokeDasharray={`${frac * C} ${C}`}
                  strokeDashoffset={-offset * C}
                  transform="rotate(-90 60 60)"
                />
              ))}
              <text x="60" y="64" textAnchor="middle" className="ringlabel">
                {formatDuration(total)}
              </text>
            </svg>
            <ul className="cats">
              {present.map((c) => (
                <li key={c.id}>
                  <span className="dot" style={{ background: c.color }} />
                  <span className="name">{c.name}</span>
                  <span className="time">{formatDuration(used.get(c.id) ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>

          {cats
            .filter((c) => c.budgetMin !== undefined)
            .map((c) => {
              const usedSec = used.get(c.id) ?? 0;
              const budgetSec = c.budgetMin! * 60;
              const ratio = Math.min(1, usedSec / budgetSec);
              return (
                <div key={c.id} className="budget">
                  <div className="budget-head">
                    <span>
                      {c.name}预算 {c.budgetMin} 分钟
                    </span>
                    <span className="time">剩 {formatDuration(Math.max(0, budgetSec - usedSec))}</span>
                  </div>
                  <div className="meter">
                    <i
                      style={{
                        width: `${Math.round(ratio * 100)}%`,
                        background: ratio >= 1 ? '#dc2626' : ratio >= 0.8 ? '#f59e0b' : c.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}

          <h2>Top 站点</h2>
          <ul className="hosts">
            {rows.slice(0, 5).map((r) => (
              <li key={`${r.categoryId}-${r.host}`}>
                <span className="dot" style={{ background: cats.find((c) => c.id === r.categoryId)?.color }} />
                <span className="name">{r.host}</span>
                <span className="time">{formatDuration(r.seconds)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {current && (
        <div className="current">
          <div className="cur-head">
            <span className="name" title={current.url}>
              {current.incognito ? '🕶 ' : ''}
              {current.host}
            </span>
            <span className="chip" style={{ background: cats.find((c) => c.id === current.categoryId)?.color }}>
              {cats.find((c) => c.id === current.categoryId)?.name ?? current.categoryId}
            </span>
          </div>
          {current.categoryId !== 'learning' && (
            <button className="mini" disabled={busy} onClick={() => void reclassify('learning')}>
              📚 本次记为学习
            </button>
          )}
          {current.categoryId !== 'entertainment' && (
            <button className="mini" disabled={busy} onClick={() => void reclassify('entertainment')}>
              🎮 本次记为娱乐
            </button>
          )}
        </div>
      )}

      <footer>
        {paused ? (
          <span>😴 监督已暂停，至 {new Date(settings.pauseUntil!).toLocaleTimeString()}</span>
        ) : (
          <button className="mini" disabled={busy} onClick={() => void pause30()}>
            暂停监督 30 分钟
          </button>
        )}
        <span className="ver">v0.2 · 数据仅存本机</span>
      </footer>
    </div>
  );
}
