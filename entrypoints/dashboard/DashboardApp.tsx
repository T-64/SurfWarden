import { useEffect, useMemo, useState } from 'react';
import { configStore } from '../../src/adapters/configStore';
import { db, todayKey } from '../../src/adapters/db';
import {
  aggregateByDate,
  aggregateByHost,
  hourBuckets,
  lastNDates,
  learningStreak,
  learningToEntertainment,
  todayVsWeekAvg,
} from '../../src/core/metrics';
import type { Category, Settings } from '../../src/core/types';
import type { SessionRow, UsageRow } from '../../src/core/types';
import { formatClock, formatDuration } from '../../src/shared/format';
import '../../src/shared/theme.css';

interface Data {
  cats: Category[];
  settings: Settings;
  weekRows: UsageRow[];
  todayRows: UsageRow[];
  todaySessions: SessionRow[];
  dates: string[];
}

async function loadData(): Promise<Data> {
  const settings = await configStore.getSettings();
  const dates = lastNDates(7, settings.dayCutoffHour);
  const [cats, weekRows, todaySessions] = await Promise.all([
    configStore.getCategories(),
    db.usageDaily.where('date').anyOf(dates).toArray(),
    db.sessions.where('date').equals(todayKey(settings.dayCutoffHour)).toArray(),
  ]);
  const today = dates[dates.length - 1];
  const todayRows = weekRows.filter((r) => r.date === today);
  return { cats, settings, weekRows, todayRows, todaySessions, dates };
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="od-card" style={{ padding: '12px 16px', flex: 1, minWidth: 140 }}>
      <p className="od-caption" style={{ margin: 0 }}>{label}</p>
      <p className="od-stat" style={{ fontSize: 24, fontWeight: 600, margin: '4px 0 0', color: color ?? 'var(--ink)' }}>
        {value}
      </p>
    </div>
  );
}

export function DashboardApp() {
  const [data, setData] = useState<Data | null>(null);
  const [scope, setScope] = useState<'today' | 'week'>('today');

  useEffect(() => {
    void loadData().then(setData);
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const { cats, weekRows, todayRows, todaySessions, dates } = data;
    const scopeRows = scope === 'today' ? todayRows : weekRows;
    const byDate = aggregateByDate(weekRows);
    const scopeByCat = new Map<string, number>();
    for (const r of scopeRows) scopeByCat.set(r.categoryId, (scopeByCat.get(r.categoryId) ?? 0) + r.seconds);
    const total = [...scopeByCat.values()].reduce((a, b) => a + b, 0);
    const maxDay = Math.max(1, ...dates.map((d) => [...(byDate.get(d)?.values() ?? [])].reduce((a, b) => a + b, 0)));
    const topHosts = aggregateByHost(scopeRows).slice(0, 8);
    const hours = hourBuckets(todaySessions);
    const maxHour = Math.max(1, ...hours);
    return {
      cats, dates, byDate, scopeByCat, total, maxDay, topHosts, hours, maxHour,
      ratio: learningToEntertainment(scopeByCat),
      streak: learningStreak(weekRows, 600, data.settings.dayCutoffHour),
      vsAvg: todayVsWeekAvg(weekRows, dates, data.settings.dayCutoffHour),
    };
  }, [data, scope]);

  if (!view) {
    return (
      <div className="od-app" style={{ minHeight: '100vh', padding: 32 }}>
        <p className="od-caption">LOADING…</p>
      </div>
    );
  }
  const { cats, dates, byDate, scopeByCat, total, maxDay, topHosts, hours, maxHour } = view;
  const scopeRowsByCat = scopeByCat;
  const present = cats.filter((c) => (scopeRowsByCat.get(c.id) ?? 0) > 0);
  const maxHost = Math.max(1, ...topHosts.map((h) => h.seconds));

  return (
    <div className="od-app" style={{ minHeight: '100vh', padding: '28px 36px 48px', maxWidth: 1080, margin: '0 auto' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <span className="od-caption" style={{ fontSize: 13, color: 'var(--ink)' }}>
            SURF<span style={{ color: 'var(--green)' }}>WARDEN</span> OPSDECK
          </span>
          <p className="od-caption" style={{ margin: '2px 0 0', textTransform: 'none', letterSpacing: 0 }}>
            {dates[0]} ~ {dates[dates.length - 1]} · 数据仅存本机
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['today', 'week'] as const).map((s) => (
            <button
              key={s}
              className="od-btn-mini"
              style={scope === s ? { color: 'var(--ink)', background: 'var(--card)' } : undefined}
              onClick={() => setScope(s)}
            >
              {s === 'today' ? '今日' : '7 日'}
            </button>
          ))}
          <button className="od-btn-mini" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })}>
            ⚙ 设置
          </button>
        </div>
      </div>

      {/* 主指标行 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat label="总时长" value={formatClock(total)} />
        <Stat label="学习" value={formatClock(scopeRowsByCat.get('learning') ?? 0)} color="var(--green)" />
        <Stat label="娱乐" value={formatClock(scopeRowsByCat.get('entertainment') ?? 0)} color="var(--red)" />
        <Stat
          label="学习 : 娱乐"
          value={view.ratio === null ? '∞' : `${view.ratio} : 1`}
          color={view.ratio !== null && view.ratio >= 1 ? 'var(--green)' : 'var(--amber)'}
        />
        <Stat label="学习连续" value={`${view.streak} 天`} color="var(--green)" />
      </div>

      {/* 7 日趋势（按日堆叠柱） */}
      <div className="od-section" style={{ marginTop: 16 }}>
        <p className="od-caption" style={{ margin: '0 0 12px' }}>7 日趋势</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140 }}>
          {dates.map((d) => {
            const byCat = byDate.get(d);
            const dayTotal = [...(byCat?.values() ?? [])].reduce((a, b) => a + b, 0);
            const isToday = d === dates[dates.length - 1];
            return (
              <div key={d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span className="od-stat" style={{ fontSize: 10, color: isToday ? 'var(--green)' : 'var(--faint)' }}>
                  {dayTotal > 0 ? formatClock(dayTotal) : '·'}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column-reverse', height: 96, width: '100%', maxWidth: 46 }}>
                  {cats.map((c) => {
                    const sec = byCat?.get(c.id) ?? 0;
                    if (sec === 0) return null;
                    return (
                      <div
                        key={c.id}
                        title={`${c.name} ${formatDuration(sec)}`}
                        style={{ height: `${(sec / maxDay) * 96}px`, background: c.color, opacity: 0.9 }}
                      />
                    );
                  })}
                  {dayTotal === 0 && <div style={{ height: 2, background: 'var(--elevated)' }} />}
                </div>
                <span className="od-caption" style={{ color: isToday ? 'var(--green)' : 'var(--faint)' }}>
                  {d.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        {/* 类别占比 */}
        <div className="od-section" style={{ flex: 1, minWidth: 320 }}>
          <p className="od-caption" style={{ margin: '0 0 12px' }}>类别构成</p>
          <div className="od-meter" style={{ height: 10, display: 'flex', borderRadius: 6 }}>
            {present.map((c) => (
              <i
                key={c.id}
                style={{
                  width: `${((scopeRowsByCat.get(c.id) ?? 0) / Math.max(1, total)) * 100}%`,
                  background: c.color,
                  borderRadius: 0,
                }}
              />
            ))}
            {present.length === 0 && <i style={{ width: '100%', background: 'var(--elevated)' }} />}
          </div>
          <div style={{ marginTop: 12 }}>
            {present.map((c) => (
              <div key={c.id} className="od-row">
                <span className="k-dot" style={{ width: 7, height: 7, borderRadius: 99, background: c.color }} />
                <span className="name">{c.name}</span>
                <span className="od-stat" style={{ fontSize: 12 }}>
                  {formatDuration(scopeRowsByCat.get(c.id) ?? 0)}
                </span>
              </div>
            ))}
            {present.length === 0 && <p className="muted" style={{ color: 'var(--faint)', fontSize: 12, margin: 0 }}>暂无数据</p>}
          </div>
        </div>

        {/* Top 站点 */}
        <div className="od-section" style={{ flex: 1, minWidth: 320 }}>
          <p className="od-caption" style={{ margin: '0 0 12px' }}>TOP 站点</p>
          {topHosts.map((h) => (
            <div key={h.host} style={{ marginBottom: 8 }}>
              <div className="od-meter-row">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--body)' }}>{h.host}</span>
                <span className="od-stat" style={{ fontSize: 12, color: 'var(--mute)' }}>{formatDuration(h.seconds)}</span>
              </div>
              <div className="od-meter" style={{ marginTop: 3 }}>
                <i style={{ width: `${(h.seconds / maxHost) * 100}%`, background: 'var(--faint)' }} />
              </div>
            </div>
          ))}
          {topHosts.length === 0 && <p style={{ color: 'var(--faint)', fontSize: 12, margin: 0 }}>暂无数据</p>}
        </div>
      </div>

      {/* 小时分布（今日） */}
      <div className="od-section" style={{ marginTop: 16 }}>
        <p className="od-caption" style={{ margin: '0 0 12px' }}>今日小时分布</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64 }}>
          {hours.map((sec, h) => (
            <div key={h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${h}:00 · ${formatDuration(sec)}`}>
              <div
                style={{
                  height: `${(sec / maxHour) * 48}px`,
                  minHeight: sec > 0 ? 3 : 0,
                  width: '100%',
                  background: sec > 0 ? 'var(--green)' : 'var(--elevated)',
                  opacity: sec > 0 ? 0.85 : 1,
                  borderRadius: 2,
                }}
              />
              {h % 6 === 0 && <span className="od-caption" style={{ fontSize: 9 }}>{String(h).padStart(2, '0')}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
