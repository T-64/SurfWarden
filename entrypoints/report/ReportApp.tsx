import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { config } from '../../src/adapters/config';
import { daysFor, eventsFor, sessionsFor, usageFor } from '../../src/adapters/db';
import { germanStreak, intentSummary, nightStats, timeline, topHosts, totalsByCategory, totalsByDate, type NightStat } from '../../src/core/metrics';
import { formatHHMM } from '../../src/core/schedule';
import type { CategoryId, DayRow, EventRow, SessionRow, Settings, UsageRow } from '../../src/core/types';
import { dateKey, lastNDates } from '../../src/shared/datetime';
import { CATEGORY_META } from '../../src/shared/defaults';
import { formatMin, hhmm } from '../../src/shared/format';
import '../../src/shared/theme.css';
import './report.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'other'];
const NIGHT_COLOR = '#a99cf8';

interface Data {
  settings: Settings;
  today: string;
  dates: string[];
  usage: UsageRow[];
  days: DayRow[];
}

interface Tip {
  x: number;
  y: number;
  text: string;
}

export function ReportApp() {
  const [data, setData] = useState<Data | null>(null);
  const [day, setDay] = useState<string>('');
  const [detail, setDetail] = useState<{ sessions: SessionRow[]; events: EventRow[] } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    void (async () => {
      const settings = await config.getSettings();
      const today = dateKey(Date.now(), settings.dayCutoffHour);
      const dates = lastNDates(today, 14);
      const [usage, days] = await Promise.all([usageFor(dates), daysFor(dates)]);
      setData({ settings, today, dates, usage, days });
      setDay(today);
    })();
  }, []);

  useEffect(() => {
    if (!day) return;
    void Promise.all([sessionsFor(day), eventsFor([day])]).then(([sessions, events]) => setDetail({ sessions, events }));
  }, [day]);

  const derived = useMemo(() => {
    if (!data) return null;
    const { settings, today, dates, usage, days } = data;
    const byDate = totalsByDate(usage);
    const nights = nightStats(days, dates, settings.schedule, settings.dayCutoffHour).filter((n) => n.date !== today || Date.now() > n.bedtimeAt);
    return {
      byDate,
      nights,
      streak: germanStreak(byDate, dates, settings.germanGoalMin * 60),
      week: dates.slice(-7).reduce((s, d) => s + (byDate.get(d)?.german ?? 0), 0),
    };
  }, [data]);

  if (!data || !derived) return <div className="od-app rep" />;
  const { settings, today, dates, usage } = data;
  const dayUsage = usage.filter((r) => r.date === day);
  const totals = totalsByCategory(dayUsage);
  const showTip = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });
  const hideTip = () => setTip(null);

  return (
    <div className="od-app rep" onMouseLeave={hideTip}>
      <header className="rep-head">
        <div>
          <h1>
            SURF<b>WARDEN</b> 报告
          </h1>
          <p className="od-caption">只统计这台电脑的浏览器 · 数据仅存本机</p>
        </div>
        <button className="od-btn-mini" onClick={() => void chrome.runtime.openOptionsPage()}>
          设置
        </button>
      </header>

      <div className="grid2">
        <Card title="作息 · 每晚最后一次上网" aside={<NightSummary nights={derived.nights} bedtime={settings.schedule.bedtime} />}>
          <NightChart nights={derived.nights} onTip={showTip} offTip={hideTip} />
          <NightTable nights={derived.nights} />
        </Card>

        <Card
          title="德语 · 每日分钟"
          aside={
            <div className="tiles">
              <Tile label="连续达标" value={`${derived.streak} 天`} />
              <Tile label="近 7 天" value={formatMin(derived.week)} />
            </div>
          }
        >
          <GermanChart dates={dates} byDate={derived.byDate} goalMin={settings.germanGoalMin} today={today} onTip={showTip} offTip={hideTip} />
        </Card>
      </div>

      <Card
        title="一天的时间去哪了"
        aside={
          <div className="days">
            {dates.slice(-7).map((d) => (
              <button key={d} className={`od-btn-mini${d === day ? ' on' : ''}`} onClick={() => setDay(d)}>
                {d === today ? '今天' : d.slice(5)}
              </button>
            ))}
          </div>
        }
      >
        <Legend />
        {detail && <Timeline sessions={detail.sessions} date={day} cutoff={settings.dayCutoffHour} onTip={showTip} offTip={hideTip} />}
        <div className="grid2 inner">
          <div>
            <p className="od-caption sub">类别</p>
            {CATS.map((c) => (
              <div className="od-row" key={c}>
                <span className="sw" style={{ background: CATEGORY_META[c].color }} />
                <span className="name">{CATEGORY_META[c].name}</span>
                <span className="od-stat">{formatMin(totals[c])}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="od-caption sub">站点 TOP 8</p>
            {topHosts(dayUsage, 8).map((h) => (
              <div className="od-row" key={h.host}>
                <span className="sw" style={{ background: CATEGORY_META[h.category].color }} />
                <span className="name mono">{h.host}</span>
                <span className="od-stat">{formatMin(h.seconds)}</span>
              </div>
            ))}
            {dayUsage.length === 0 && <p className="empty">这一天没有记录。</p>}
          </div>
        </div>
      </Card>

      {detail && <IntentLog events={detail.events} usage={dayUsage} />}

      {tip && (
        <div className="tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

// ---------- 部件 ----------

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="od-section card">
      <div className="card-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <span className="od-caption">{label}</span>
      <span className="od-stat">{value}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {CATS.map((c) => (
        <span key={c}>
          <i style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].name}
        </span>
      ))}
    </div>
  );
}

type TipFn = (e: React.MouseEvent, text: string) => void;

/** 图按容器实际像素宽度绘制（不用 viewBox 缩放），窄屏下文字仍是 10px */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------- 作息 ----------

/** y 轴：就寝 −3h … +4h（夜间相对时间），超出夹到边缘 */
const NIGHT_MIN = -180;
const NIGHT_MAX = 240;

function NightSummary({ nights, bedtime }: { nights: NightStat[]; bedtime: number }) {
  const known = nights.filter((n) => n.lateMin !== null);
  const onTime = known.filter((n) => n.lateMin! <= 0).length;
  return (
    <div className="tiles">
      <Tile label={`${formatHHMM(bedtime)} 前下线`} value={known.length ? `${onTime} / ${known.length} 晚` : '—'} />
    </div>
  );
}

function NightChart({ nights, onTip, offTip }: { nights: NightStat[]; onTip: TipFn; offTip: () => void }) {
  const [ref, W] = useWidth();
  const H = 190;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(nights.length, 1);
  const x = (i: number) => pad.l + (iw * (i + 0.5)) / n;
  const y = (m: number) => pad.t + (ih * (Math.min(NIGHT_MAX, Math.max(NIGHT_MIN, m)) - NIGHT_MIN)) / (NIGHT_MAX - NIGHT_MIN);
  const ticks = [-120, -60, 0, 60, 120, 180, 240];
  const bed = nights[0]?.bedtimeAt;
  const label = (m: number) => (bed ? hhmm(bed + m * 60_000) : '');
  const last = [...nights].reverse().find((nn) => nn.lateMin !== null);

  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart" role="img" aria-label="每晚最后上网时间">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'ref' : 'grid'} />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">
              {label(t)}
            </text>
          </g>
        ))}
        <text x={pad.l + 4} y={y(0) - 6} className="axis ref-label">
          就寝
        </text>
        {nights.map((nt, i) => (
          <g key={nt.date}>
            <text x={x(i)} y={H - 8} className="axis" textAnchor="middle">
              {nt.date.slice(8)}
            </text>
            {nt.lateMin !== null && (
              <>
                <circle cx={x(i)} cy={y(nt.lateMin)} r={5} fill={NIGHT_COLOR} stroke="var(--surface)" strokeWidth={2} />
                <rect
                  x={x(i) - iw / n / 2}
                  y={pad.t}
                  width={iw / n}
                  height={ih}
                  fill="transparent"
                  onMouseMove={(e) =>
                    onTip(
                      e,
                      `${nt.date} 晚 · 最后上网 ${hhmm(nt.lastAt!)}（${nt.lateMin! > 0 ? `晚 ${nt.lateMin} 分` : `早 ${-nt.lateMin!} 分`}）${
                        nt.firstNextAt ? ` · 次日首次 ${hhmm(nt.firstNextAt)}` : ''
                      }`,
                    )
                  }
                  onMouseLeave={offTip}
                />
              </>
            )}
          </g>
        ))}
        {last && (
          <text x={x(nights.indexOf(last))} y={y(last.lateMin!) - 10} className="val" textAnchor="middle">
            {hhmm(last.lastAt!)}
          </text>
        )}
      </svg>
    </div>
  );
}

function NightTable({ nights }: { nights: NightStat[] }) {
  return (
    <details className="table-view">
      <summary className="od-caption">表格</summary>
      <table className="od-table">
        <thead>
          <tr>
            <th>晚上</th>
            <th>最后上网</th>
            <th>相对就寝</th>
            <th>次日首次上网</th>
          </tr>
        </thead>
        <tbody>
          {[...nights].reverse().map((n) => (
            <tr key={n.date}>
              <td>{n.date}</td>
              <td className="mono">{n.lastAt ? hhmm(n.lastAt) : '—'}</td>
              <td className="mono">{n.lateMin === null ? '—' : n.lateMin > 0 ? `+${n.lateMin} 分` : `${n.lateMin} 分`}</td>
              <td className="mono">{n.firstNextAt ? hhmm(n.firstNextAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---------- 德语 ----------

function GermanChart({
  dates,
  byDate,
  goalMin,
  today,
  onTip,
  offTip,
}: {
  dates: string[];
  byDate: Map<string, Record<CategoryId, number>>;
  goalMin: number;
  today: string;
  onTip: TipFn;
  offTip: () => void;
}) {
  const [ref, W] = useWidth();
  const H = 190;
  const pad = { l: 32, r: 12, t: 14, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const mins = dates.map((d) => Math.round((byDate.get(d)?.german ?? 0) / 60));
  const max = Math.max(goalMin * 1.25, ...mins, 10);
  const y = (m: number) => pad.t + ih - (ih * m) / max;
  const slot = iw / dates.length;
  const bw = Math.min(24, slot - 6);
  const step = max > 120 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);

  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart" role="img" aria-label="每日德语分钟">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(goalMin)} y2={y(goalMin)} className="ref" />
        <text x={pad.l + 4} y={y(goalMin) - 6} className="axis ref-label">
          目标 {goalMin}
        </text>
        {dates.map((d, i) => {
          const cx = pad.l + slot * (i + 0.5);
          const m = mins[i]!;
          const h = Math.max(0, y(0) - y(m));
          return (
            <g key={d}>
              {m > 0 && <path d={roundTop(cx - bw / 2, y(m), bw, h, Math.min(4, h))} fill={CATEGORY_META.german.color} />}
              {(W > 420 || i % 2 === (dates.length - 1) % 2) && (
                <text x={cx} y={H - 8} className={`axis${d === today ? ' strong' : ''}`} textAnchor="middle">
                  {d === today ? '今' : d.slice(8)}
                </text>
              )}
              {d === today && m > 0 && (
                <text x={cx} y={y(m) - 6} className="val" textAnchor="middle">
                  {m}
                </text>
              )}
              <rect
                x={cx - slot / 2}
                y={pad.t}
                width={slot}
                height={ih}
                fill="transparent"
                onMouseMove={(e) => onTip(e, `${d} · 德语 ${m} 分${m >= goalMin ? ' ✓ 达标' : ''}`)}
                onMouseLeave={offTip}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 顶部 4px 圆角、底部方角的柱 */
function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------- 时间线 ----------

function Timeline({ sessions, date, cutoff, onTip, offTip }: { sessions: SessionRow[]; date: string; cutoff: number; onTip: TipFn; offTip: () => void }) {
  const blocks = timeline(sessions, date, cutoff);
  const [ref, W] = useWidth();
  const H = 46;
  const barH = 22;
  const hours = Array.from({ length: 9 }, (_, i) => i * 3).filter((h) => W > 520 || h % 6 === 0);
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart timeline" role="img" aria-label="一天的时间线">
        <rect x={0} y={0} width={W} height={barH} rx={4} className="track" />
        {blocks.map((b, i) => {
          const x = b.from * W;
          const w = Math.max(1, (b.to - b.from) * W - 2); // 2px 表面间隙
          return (
            <rect
              key={i}
              x={x}
              y={0}
              width={w}
              height={barH}
              fill={CATEGORY_META[b.category].color}
              onMouseMove={(e) => onTip(e, `${CATEGORY_META[b.category].name} · ${b.host} · ${hourLabel(b.from, cutoff)}–${hourLabel(b.to, cutoff)}`)}
              onMouseLeave={offTip}
            />
          );
        })}
        {hours.map((h) => (
          <text key={h} x={(h / 24) * W} y={H - 4} className="axis" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {String((cutoff + h) % 24).padStart(2, '0')}
          </text>
        ))}
      </svg>
    </div>
  );
}

function hourLabel(frac: number, cutoff: number): string {
  const min = Math.round(frac * 1440) + cutoff * 60;
  return formatHHMM(min % 1440);
}

// ---------- 意图日志 ----------

function IntentLog({ events, usage }: { events: EventRow[]; usage: UsageRow[] }) {
  const sites = intentSummary(events, usage);
  const exts = events.filter((e) => e.type === 'curfew-ext');
  const goGerman = events.filter((e) => e.type === 'go-german').length;
  return (
    <Card title="意图日志 · 说要看多久 vs 实际看了多久" aside={goGerman > 0 ? <span className="od-caption">从拦截页去学德语 {goGerman} 次</span> : undefined}>
      {sites.length === 0 && exts.length === 0 && <p className="empty">这一天没有进入过娱乐站。</p>}
      {sites.map((s) => (
        <div className="intent" key={s.site}>
          <div className="od-row">
            <span className="name mono">{s.site}</span>
            <span className="od-stat">
              申请 {s.grantedMin} 分 · 实际 <b>{s.actualMin}</b> 分
              {s.actualMin > s.grantedMin && <span className="over"> ▲ 超出 {s.actualMin - s.grantedMin}</span>}
            </span>
          </div>
          {s.entries.map((e) => (
            <p key={e.at} className="entry">
              <span className="mono">{hhmm(e.at)}</span> 「{e.intent}」· {e.minutes} 分
            </p>
          ))}
        </div>
      ))}
      {exts.map((e) => (
        <p key={e.id ?? e.at} className="entry night">
          <span className="mono">{hhmm(e.at)}</span> 宵禁延长 {e.minutes} 分 ·「{e.reason}」
        </p>
      ))}
    </Card>
  );
}
