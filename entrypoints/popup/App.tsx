import { useCallback, useEffect, useState } from 'react';
import { configStore } from '../../src/adapters/configStore';
import { todayKey, usageForDate } from '../../src/adapters/db';
import { budgetState, usageByCategory } from '../../src/core/budget';
import { suggestForHost } from '../../src/core/siteCatalog';
import type { Category, Settings, UsageRow } from '../../src/core/types';
import { formatClock, formatDuration } from '../../src/shared/format';
import '../../src/shared/theme.css';

interface CurrentInfo {
  url: string;
  host: string;
  categoryId: string;
  ruleId?: string;
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
  let current = (res?.current as CurrentInfo | null) ?? null;
  // 演示钩子（?demo=1，仅截图/开发用）：模拟"正在浏览未分类站点"
  const demo = new URLSearchParams(location.search).has('demo');
  if (!current && demo) {
    current = {
      url: 'https://www.zhihu.com/hot',
      host: 'www.zhihu.com',
      categoryId: 'neutral',
      startedAt: Date.now() - 90_000,
      incognito: false,
    };
  }
  return {
    cats,
    rows: [...rows].sort((a, b) => b.seconds - a.seconds),
    settings,
    current,
  };
}

const R = 46;
const C = 2 * Math.PI * R;

export function App() {
  const [data, setData] = useState<PopupData | null>(null);
  const [busy, setBusy] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    void loadData().then(setData);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) {
    return (
      <div className="od-app" style={{ width: 340, padding: 16 }}>
        <p className="od-caption" style={{ margin: 0 }}>LOADING…</p>
      </div>
    );
  }
  const { cats, rows, settings, current } = data;
  const used = usageByCategory(rows);
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const present = cats.filter((c) => (used.get(c.id) ?? 0) > 0);
  const paused = settings.pauseUntil !== undefined && Date.now() < settings.pauseUntil;
  const curCat = current ? cats.find((c) => c.id === current.categoryId) : undefined;
  // 站点情报（ADR-0011）：未分类 + 目录可匹配 → 建议卡
  const suggestion =
    current && current.ruleId === undefined && !ignored.has(current.host)
      ? suggestForHost(current.host)
      : null;

  async function adoptSuggestion(): Promise<void> {
    if (!current || !suggestion) return;
    setBusy(true);
    await chrome.runtime.sendMessage({
      type: 'sw-add-rule',
      name: suggestion.name,
      pattern: suggestion.pattern,
      category: suggestion.category,
    });
    refresh();
    setBusy(false);
  }

  async function reclassify(categoryId: string): Promise<void> {
    setBusy(true);
    await chrome.runtime.sendMessage({ type: 'sw-reclassify', categoryId });
    refresh();
    setBusy(false);
  }

  async function pause30(): Promise<void> {
    setBusy(true);
    await configStore.saveSettings({ ...settings, pauseUntil: Date.now() + 30 * 60_000 });
    refresh();
    setBusy(false);
  }

  // 环形图 arc
  let acc = 0;
  const arcs = present.map((c) => {
    const frac = total > 0 ? (used.get(c.id) ?? 0) / total : 0;
    const arc = { c, frac, offset: acc };
    acc += frac;
    return arc;
  });

  // 娱乐预算读数
  const ent = cats.find((c) => c.id === 'entertainment');
  const entUsed = ent ? (used.get(ent.id) ?? 0) : 0;
  const entState = ent ? budgetState(entUsed, ent.budgetMin) : 'ok';

  return (
    <div className="od-app" style={{ width: 340, padding: '14px 16px 12px' }}>
      {/* 品牌行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="od-caption" style={{ color: 'var(--ink)' }}>
          SURF<span style={{ color: 'var(--green)' }}>WARDEN</span>
        </span>
        {paused ? (
          <span className="od-pill"><span className="p-dot" style={{ background: 'var(--faint)' }} />监督暂停中</span>
        ) : current ? (
          <span className="od-pill">
            <span className="p-dot" style={{ background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
            记录中
          </span>
        ) : (
          <span className="od-pill"><span className="p-dot" style={{ background: 'var(--faint)' }} />待机</span>
        )}
      </div>

      {/* 当前段实时状态（启发式 #1：系统状态可见性） */}
      {current && (
        <div className="od-card-raised" style={{ padding: '9px 12px', marginBottom: 12 }}>
          <div className="od-row" style={{ padding: 0, borderBottom: 'none' }}>
            <span className="k-dot" style={{ width: 7, height: 7, borderRadius: 99, background: curCat?.color ?? 'var(--mute)' }} />
            <span className="name" title={current.url} style={{ fontSize: 12 }}>
              {current.incognito ? '🕶 ' : ''}{current.host}
            </span>
            <span className="od-stat" style={{ fontSize: 12, color: 'var(--mute)' }}>
              {formatDuration(Math.floor((Date.now() - current.startedAt) / 1000))}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {current.categoryId !== 'learning' && (
              <button className="od-btn-mini" disabled={busy} onClick={() => void reclassify('learning')}>📚 记为学习</button>
            )}
            {current.categoryId !== 'entertainment' && (
              <button className="od-btn-mini" disabled={busy} onClick={() => void reclassify('entertainment')}>🎮 记为娱乐</button>
            )}
          </div>
        </div>
      )}

      {/* 站点情报建议卡（ADR-0011） */}
      {suggestion && (
        <div className="od-card-raised" style={{ padding: '9px 12px', marginBottom: 12 }}>
          <div className="od-caption" style={{ marginBottom: 6 }}>⚡ 未分类站点</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span className="od-key"><span className="k-dot" style={{ background: 'var(--amber)' }} />{suggestion.group}</span>
            <span style={{ fontSize: 12, color: 'var(--body)' }}>{suggestion.name} → {cats.find((c) => c.id === suggestion.category)?.name ?? suggestion.category}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="od-btn-mini" disabled={busy} style={{ color: 'var(--green)' }} onClick={() => void adoptSuggestion()}>
              ✓ 采纳为规则
            </button>
            <button className="od-btn-mini" onClick={() => setIgnored(new Set(ignored).add(current!.host))}>
              忽略
            </button>
          </div>
        </div>
      )}

      {/* 今日仪表 */}
      {total === 0 ? (
        <div className="od-card" style={{ padding: 20, textAlign: 'center' }}>
          <p className="od-stat" style={{ fontSize: 22, margin: 0 }}>00:00</p>
          <p className="od-caption" style={{ margin: '6px 0 0' }}>今天还没有记录</p>
        </div>
      ) : (
        <div className="od-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width="104" height="104" viewBox="0 0 104 104" style={{ flex: 'none' }}>
              <circle cx="52" cy="52" r={R} fill="none" stroke="var(--elevated)" strokeWidth="10" />
              {arcs.map(({ c, frac, offset }) => (
                <circle
                  key={c.id} cx="52" cy="52" r={R} fill="none"
                  stroke={c.color} strokeWidth="10" strokeLinecap="butt"
                  strokeDasharray={`${Math.max(0, frac * C - 2)} ${C}`}
                  strokeDashoffset={-offset * C}
                  transform="rotate(-90 52 52)"
                />
              ))}
              <text x="52" y="50" textAnchor="middle" style={{ fill: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 600 }}>
                {formatClock(total)}
              </text>
              <text x="52" y="67" textAnchor="middle" className="od-caption">TODAY</text>
            </svg>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1 }}>
              {present.map((c) => (
                <li key={c.id} className="od-row">
                  <span className="k-dot" style={{ width: 7, height: 7, borderRadius: 99, background: c.color }} />
                  <span className="name" style={{ fontSize: 12 }}>{c.name}</span>
                  <span className="od-stat" style={{ fontSize: 12 }}>{formatDuration(used.get(c.id) ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 预算仪表（有预算的类别） */}
          {cats
            .filter((c) => c.budgetMin !== undefined)
            .map((c) => {
              const usedSec = used.get(c.id) ?? 0;
              const budgetSec = c.budgetMin! * 60;
              const ratio = Math.min(1, usedSec / budgetSec);
              const st = budgetState(usedSec, c.budgetMin);
              const barColor = st === 'exhausted' ? 'var(--red)' : st === 'warn' ? 'var(--amber)' : c.color;
              return (
                <div key={c.id} style={{ marginTop: 12 }}>
                  <div className="od-meter-row">
                    <span className="od-caption">{c.name}预算 {c.budgetMin}′</span>
                    <span className="od-stat" style={{ fontSize: 12, color: barColor }}>
                      {st === 'exhausted' ? '已耗尽' : `剩 ${formatDuration(Math.max(0, budgetSec - usedSec))}`}
                    </span>
                  </div>
                  <div className="od-meter" style={{ marginTop: 4 }}>
                    <i style={{ width: `${Math.round(ratio * 100)}%`, background: barColor }} />
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Top 站点 */}
      {rows.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="od-caption" style={{ margin: '0 0 4px' }}>TOP 站点</p>
          <div className="od-card" style={{ padding: '4px 12px' }}>
            {rows.slice(0, 5).map((r) => (
              <div key={`${r.categoryId}-${r.host}`} className="od-row">
                <span className="k-dot" style={{ width: 6, height: 6, borderRadius: 99, background: cats.find((c) => c.id === r.categoryId)?.color ?? 'var(--mute)' }} />
                <span className="name" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{r.host}</span>
                <span className="od-stat" style={{ fontSize: 12, color: 'var(--mute)' }}>{formatDuration(r.seconds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 专注模式（IT4） */}
      {(() => {
        const focusActive = settings.focusUntil !== undefined && Date.now() < settings.focusUntil;
        if (focusActive) {
          const remain = Math.max(0, Math.ceil(((settings.focusUntil ?? 0) - Date.now()) / 60_000));
          return (
            <div className="od-card-raised" style={{ padding: '9px 12px', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--ink)' }}>🎯 专注中 · 剩 <span className="od-stat">{remain}</span> 分</span>
              <button className="od-btn-mini" disabled={busy} onClick={() => void chrome.runtime.sendMessage({ type: 'sw-focus-end' }).then(refresh)}>
                结束
              </button>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
            <span className="od-caption" style={{ margin: 0 }}>专注</span>
            {[30, 45, 60].map((m) => (
              <button
                key={m}
                className="od-btn-mini"
                disabled={busy}
                onClick={() => void chrome.runtime.sendMessage({ type: 'sw-focus', minutes: m }).then(refresh)}
              >
                {m}′
              </button>
            ))}
          </div>
        );
      })()}

      {/* 底栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        {paused ? (
          <span className="od-caption">恢复于 {new Date(settings.pauseUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        ) : (
          <button className="od-btn-mini" disabled={busy} onClick={() => void pause30()}>暂停监督 30′</button>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className="od-btn-mini" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })}>
            📊 报告
          </button>
          <span className="od-caption" style={{ letterSpacing: 0 }}>v{chrome.runtime.getManifest().version}</span>
        </div>
      </div>
    </div>
  );
}
