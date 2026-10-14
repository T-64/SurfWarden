import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { config } from '../../src/adapters/config';
import { daysFor, eventsFor, sessionsFor, usageFor } from '../../src/adapters/db';
import {
  germanStreak,
  intentSummary,
  nightStats,
  privateSummary,
  timeline,
  topHosts,
  totalsByCategory,
  totalsByDate,
  type CategoryTotals,
  type NightStat,
} from '../../src/core/metrics';
import { formatHHMM, phaseAt } from '../../src/core/schedule';
import type { CategoryId, DayRow, EventRow, SessionRow, Settings, UsageRow } from '../../src/core/types';
import { dateKey, lastNDates } from '../../src/shared/datetime';
import { CATEGORY_META } from '../../src/shared/defaults';
import { formatMin, hhmm } from '../../src/shared/format';
import { useBodyMood } from '../../src/shared/mood';
import '../../src/shared/theme.css';
import './report.css';

const CATS: CategoryId[] = ['german', 'study', 'drift', 'private', 'other'];

interface Data {
  settings: Settings;
  today: string;
  dates: string[];
  usage: UsageRow[];
  days: DayRow[];
  events: EventRow[];
}

interface Tip {
  x: number;
  y: number;
  text: string;
}
type TipFn = (e: React.MouseEvent, text: string) => void;

export function ReportApp() {
  const [data, setData] = useState<Data | null>(null);
  const [day, setDay] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [tip, setTip] = useState<Tip | null>(null);
  const mood = data && phaseAt(Date.now(), data.settings.schedule) !== 'day' ? 'night' : 'day';
  useBodyMood(mood);

  useEffect(() => {
    void (async () => {
      const settings = await config.getSettings();
      const today = dateKey(Date.now(), settings.dayCutoffHour);
      const dates = lastNDates(today, 14);
      const [usage, days, events] = await Promise.all([usageFor(dates), daysFor(dates), eventsFor(dates)]);
      setData({ settings, today, dates, usage, days, events });
      setDay(today);
    })();
  }, []);

  useEffect(() => {
    if (day) void sessionsFor(day).then(setSessions);
  }, [day]);

  const derived = useMemo(() => {
    if (!data) return null;
    const { settings, today, dates, usage, days, events } = data;
    const byDate = totalsByDate(usage);
    const nights = nightStats(days, dates, settings.schedule, settings.dayCutoffHour).filter((n) => n.date !== today || Date.now() > n.bedtimeAt);
    const week = dates.slice(-7);
    return {
      byDate,
      nights,
      streak: germanStreak(byDate, dates, settings.germanGoalMin * 60),
      weekGerman: week.reduce((s, d) => s + (byDate.get(d)?.german ?? 0), 0),
      weekPrivate: privateSummary(events.filter((e) => week.includes(e.date))),
    };
  }, [data]);

  if (!data || !derived) return <div className="sw rep" />;
  const { settings, today, dates, usage, events } = data;
  const dayUsage = usage.filter((r) => r.date === day);
  const dayEvents = events.filter((e) => e.date === day);
  const totals = totalsByCategory(dayUsage);
  const known = derived.nights.filter((n) => n.lateMin !== null);
  const onTime = known.filter((n) => n.lateMin! <= 0).length;
  const showTip: TipFn = (e, text) => setTip({ x: e.clientX, y: e.clientY, text });
  const hideTip = () => setTip(null);

  return (
    <div className="sw rep" data-mood={mood} onMouseLeave={hideTip}>
      <header className="rep-head">
        <div>
          <p className="sw-label">SurfWarden · 最近两周</p>
          <h1 className="sw-title">{headline(onTime, known.length, derived.streak)}</h1>
        </div>
        <button className="sw-btn-quiet" onClick={() => void chrome.runtime.openOptionsPage()}>
          设置
        </button>
      </header>

      <div className="grid2">
        <Section
          title="每晚最后一次上网"
          figure={<Figure value={known.length ? `${onTime}/${known.length}` : '—'} label={`晚在 ${formatHHMM(settings.schedule.bedtime)} 前下线`} />}
        >
          <NightChart nights={derived.nights} onTip={showTip} offTip={hideTip} />
          <NightTable nights={derived.nights} />
        </Section>

        <Section
          title="德语"
          figure={
            <div className="figs">
              <Figure value={`${derived.streak}`} label="天连续达标" />
              <Figure value={formatMin(derived.weekGerman).replace(' 分钟', '′').replace(' 小时 ', 'h ').replace(' 分', '′')} label="近 7 天" />
            </div>
          }
        >
          <GermanChart dates={dates} byDate={derived.byDate} goalMin={settings.germanGoalMin} today={today} onTip={showTip} offTip={hideTip} />
        </Section>
      </div>

      <Section
        title="一天的时间去哪了"
        figure={
          <div className="days">
            {dates.slice(-7).map((d) => (
              <button key={d} className={d === day ? 'on' : ''} onClick={() => setDay(d)}>
                {d === today ? '今天' : d.slice(5).replace('-', '/')}
              </button>
            ))}
          </div>
        }
      >
        <Legend />
        <Timeline sessions={sessions} date={day} cutoff={settings.dayCutoffHour} onTip={showTip} offTip={hideTip} />
        <div className="grid2 inner">
          <Totals totals={totals} />
          <div>
            <p className="sw-label sub">站点</p>
            {topHosts(dayUsage, 8).map((h) => (
              <div className="line" key={h.host}>
                <Swatch c={h.category} />
                <span className={`name${h.category === 'private' ? '' : ' sw-mono'}`}>{h.host}</span>
                <span className="sw-num val">{formatMin(h.seconds)}</span>
              </div>
            ))}
            {dayUsage.length === 0 && <p className="sw-note">这一天没有记录。</p>}
          </div>
        </div>
      </Section>

      <div className="grid2">
        <IntentLog events={dayEvents} usage={dayUsage} />
        <PrivateCard week={derived.weekPrivate} />
      </div>

      <p className="sw-note foot">只统计这台电脑上的浏览器，手机不在其中。所有数据只存在本机。</p>

      {tip && (
        <div className="tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

function headline(onTime: number, nights: number, streak: number): string {
  if (nights === 0) return '记录刚开始，先用几天看看。';
  const rate = onTime / nights;
  const sleep = rate >= 0.7 ? '大多数晚上按时下线了' : rate >= 0.4 ? '一半左右的晚上按时下线' : '晚上下线还偏晚';
  return streak >= 2 ? `${sleep}，德语连续 ${streak} 天达标。` : `${sleep}。`;
}

// ---------- 版式部件 ----------

function Section({ title, figure, children }: { title: string; figure?: ReactNode; children: ReactNode }) {
  return (
    <section className="sw-card sec">
      <div className="sec-head">
        <h2 className="sw-h2">{title}</h2>
        {figure}
      </div>
      {children}
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="fig">
      <span className="sw-num">{value}</span>
      <span className="sw-note">{label}</span>
    </div>
  );
}

function Swatch({ c }: { c: CategoryId }) {
  return <span className={`sw-swatch${c === 'private' ? ' hatch' : ''}`} style={c === 'private' ? undefined : { background: CATEGORY_META[c].color }} />;
}

function Legend() {
  return (
    <div className="legend">
      {CATS.map((c) => (
        <span key={c}>
          <Swatch c={c} />
          {CATEGORY_META[c].name}
        </span>
      ))}
    </div>
  );
}

function Totals({ totals }: { totals: CategoryTotals }) {
  return (
    <div>
      <p className="sw-label sub">类别</p>
      {CATS.map((c) => (
        <div className="line" key={c}>
          <Swatch c={c} />
          <span className="name">{CATEGORY_META[c].name}</span>
          <span className="sw-num val">{formatMin(totals[c])}</span>
        </div>
      ))}
    </div>
  );
}

/** 图按容器实际像素宽度绘制（不用 viewBox 缩放），窄屏下文字仍是 10px */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
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

/** y 轴：就寝 −3h … +4h，越晚越靠下（像夜色往下沉） */
const NIGHT_MIN = -180;
const NIGHT_MAX = 240;

function NightChart({ nights, onTip, offTip }: { nights: NightStat[]; onTip: TipFn; offTip: () => void }) {
  const [ref, W] = useWidth();
  const H = 200;
  const pad = { l: 44, r: 10, t: 14, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(nights.length, 1);
  const x = (i: number) => pad.l + (iw * (i + 0.5)) / n;
  const y = (m: number) => pad.t + (ih * (Math.min(NIGHT_MAX, Math.max(NIGHT_MIN, m)) - NIGHT_MIN)) / (NIGHT_MAX - NIGHT_MIN);
  const bed = nights[0]?.bedtimeAt;
  const last = [...nights].reverse().find((nn) => nn.lateMin !== null);
  const pts = nights.map((nt, i) => (nt.lateMin === null ? null : `${x(i)},${y(nt.lateMin)}`)).filter(Boolean);

  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart" role="img" aria-label="每晚最后上网时间">
        <rect x={pad.l} y={y(0)} width={iw} height={y(NIGHT_MAX) - y(0)} className="late-zone" />
        {[-120, -60, 0, 60, 120, 180, 240].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'ref' : 'grid'} />
            <text x={pad.l - 8} y={y(t) + 3.5} className="axis" textAnchor="end">
              {bed ? hhmm(bed + t * 60_000) : ''}
            </text>
          </g>
        ))}
        <text x={pad.l + 6} y={y(0) - 6} className="axis ref-label">
          就寝
        </text>
        {pts.length > 1 && <polyline points={pts.join(' ')} className="night-line" />}
        {nights.map((nt, i) => (
          <g key={nt.date}>
            {(W > 420 || i % 2 === (nights.length - 1) % 2) && (
              <text x={x(i)} y={H - 8} className="axis" textAnchor="middle">
                {nt.date.slice(8)}
              </text>
            )}
            {nt.lateMin !== null && (
              <>
                <circle cx={x(i)} cy={y(nt.lateMin)} r={4.5} className={`night-dot${nt.lateMin <= 0 ? ' ok' : ''}`} />
                <rect
                  x={x(i) - iw / n / 2}
                  y={pad.t}
                  width={iw / n}
                  height={ih}
                  fill="transparent"
                  onMouseMove={(e) =>
                    onTip(
                      e,
                      `${nt.date.slice(5)} 晚 · 最后上网 ${hhmm(nt.lastAt!)}（${nt.lateMin! > 0 ? `晚 ${nt.lateMin} 分` : `早 ${-nt.lateMin!} 分`}）${
                        nt.firstNextAt ? ` · 次日 ${hhmm(nt.firstNextAt)} 首次上网` : ''
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
          <text x={x(nights.indexOf(last))} y={y(last.lateMin!) - 11} className="val" textAnchor="middle">
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
      <summary>表格</summary>
      <table>
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
              <td>{n.date.slice(5)}</td>
              <td className="sw-num">{n.lastAt ? hhmm(n.lastAt) : '—'}</td>
              <td className="sw-num">{n.lateMin === null ? '—' : n.lateMin > 0 ? `+${n.lateMin} 分` : `${n.lateMin} 分`}</td>
              <td className="sw-num">{n.firstNextAt ? hhmm(n.firstNextAt) : '—'}</td>
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
  byDate: Map<string, CategoryTotals>;
  goalMin: number;
  today: string;
  onTip: TipFn;
  offTip: () => void;
}) {
  const [ref, W] = useWidth();
  const H = 200;
  const pad = { l: 30, r: 10, t: 16, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const mins = dates.map((d) => Math.round((byDate.get(d)?.german ?? 0) / 60));
  const max = Math.max(goalMin * 1.3, ...mins, 10);
  const y = (m: number) => pad.t + ih - (ih * m) / max;
  const slot = iw / dates.length;
  const bw = Math.min(18, slot - 8);
  const step = max > 120 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);

  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart" role="img" aria-label="每日德语分钟">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 3.5} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(goalMin)} y2={y(goalMin)} className="ref" />
        <text x={pad.l + 6} y={y(goalMin) - 6} className="axis ref-label">
          目标 {goalMin}
        </text>
        {dates.map((d, i) => {
          const cx = pad.l + slot * (i + 0.5);
          const m = mins[i]!;
          const h = Math.max(0, y(0) - y(m));
          const met = m >= goalMin;
          return (
            <g key={d}>
              {m > 0 && <path d={roundTop(cx - bw / 2, y(m), bw, h, Math.min(4, h))} style={{ fill: 'var(--c-german)', opacity: met ? 1 : 0.55 }} />}
              {(W > 420 || i % 2 === (dates.length - 1) % 2) && (
                <text x={cx} y={H - 8} className={`axis${d === today ? ' strong' : ''}`} textAnchor="middle">
                  {d === today ? '今' : d.slice(8)}
                </text>
              )}
              {d === today && m > 0 && (
                <text x={cx} y={y(m) - 7} className="val" textAnchor="middle">
                  {m}
                </text>
              )}
              <rect
                x={cx - slot / 2}
                y={pad.t}
                width={slot}
                height={ih}
                fill="transparent"
                onMouseMove={(e) => onTip(e, `${d.slice(5)} · 德语 ${m} 分${met ? '（达标）' : ''}`)}
                onMouseLeave={offTip}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 顶部圆角、底部方角的柱 */
function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ---------- 时间线 ----------

function Timeline({ sessions, date, cutoff, onTip, offTip }: { sessions: SessionRow[]; date: string; cutoff: number; onTip: TipFn; offTip: () => void }) {
  const blocks = timeline(sessions, date, cutoff);
  const [ref, W] = useWidth();
  const H = 52;
  const barH = 26;
  const hours = Array.from({ length: 9 }, (_, i) => i * 3).filter((h) => W > 520 || h % 6 === 0);
  return (
    <div ref={ref}>
      <svg width={W} height={H} className="chart" role="img" aria-label="一天的时间线">
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" style={{ fill: 'var(--surface)' }} />
            <rect width="1.6" height="5" style={{ fill: 'var(--hatch)' }} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={W} height={barH} rx={6} className="track" />
        {blocks.map((b, i) => (
          <rect
            key={i}
            x={b.from * W}
            y={0}
            width={Math.max(1.5, (b.to - b.from) * W - 2)}
            height={barH}
            style={{ fill: b.category === 'private' ? 'url(#hatch)' : CATEGORY_META[b.category].color }}
            onMouseMove={(e) => onTip(e, `${CATEGORY_META[b.category].name} · ${b.host} · ${hourLabel(b.from, cutoff)}–${hourLabel(b.to, cutoff)}`)}
            onMouseLeave={offTip}
          />
        ))}
        {hours.map((h) => (
          <text key={h} x={(h / 24) * W} y={H - 6} className="axis" textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
            {String((cutoff + h) % 24).padStart(2, '0')}
          </text>
        ))}
      </svg>
    </div>
  );
}

function hourLabel(frac: number, cutoff: number): string {
  return formatHHMM((Math.round(frac * 1440) + cutoff * 60) % 1440);
}

// ---------- 意图与私密 ----------

function IntentLog({ events, usage }: { events: EventRow[]; usage: UsageRow[] }) {
  const sites = intentSummary(events, usage);
  const exts = events.filter((e) => e.type === 'curfew-ext');
  const goGerman = events.filter((e) => e.type === 'go-german').length;
  return (
    <Section title="说要看多久，实际看了多久" figure={goGerman > 0 ? <Figure value={`${goGerman}`} label="次从拦截页去学德语" /> : undefined}>
      {sites.length === 0 && exts.length === 0 && <p className="sw-note">这一天没有进入过娱乐站。</p>}
      {sites.map((s) => (
        <div className="intent" key={s.site}>
          <div className="line">
            <span className="name sw-mono">{s.site}</span>
            <span className="cmp">
              说 <b className="sw-num">{s.grantedMin}</b> · 实际 <b className="sw-num">{s.actualMin}</b> 分
              {s.actualMin > s.grantedMin && <span className="over"> ▲ {s.actualMin - s.grantedMin}</span>}
            </span>
          </div>
          {s.entries.map((e) => (
            <p key={e.at} className="entry">
              <span className="sw-num">{hhmm(e.at)}</span>「{e.intent}」{e.minutes} 分钟
            </p>
          ))}
        </div>
      ))}
      {exts.map((e) => (
        <p key={e.id ?? e.at} className="entry night">
          <span className="sw-num">{hhmm(e.at)}</span> 宵禁延长 {e.minutes} 分钟 ·「{e.reason}」
        </p>
      ))}
    </Section>
  );
}

function PrivateCard({ week }: { week: ReturnType<typeof privateSummary> }) {
  const total = week.entered + week.skipped;
  const actions = Object.entries(week.actions).sort((a, b) => b[1] - a[1]);
  return (
    <Section title="私密 · 近 7 天" figure={total > 0 ? <Figure value={`${week.skipped}/${total}`} label="次冷静后离开" /> : undefined}>
      {total === 0 ? (
        <p className="sw-note">没有触发过冷静期。</p>
      ) : (
        <>
          <p className="sw-note">冷静期后离开 {week.skipped} 次，进入 {week.entered} 次。频率本身没有好坏，这里只记录"是不是你自己决定的"。</p>
          {actions.map(([a, n]) => (
            <div className="line" key={a}>
              <span className="name">{a}</span>
              <span className="sw-num val">{n} 次</span>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}
