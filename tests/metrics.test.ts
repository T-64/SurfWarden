import { describe, expect, it } from 'vitest';
import { germanStreak, intentSummary, nightStats, timeline, topHosts, totalsByCategory, totalsByDate } from '../src/core/metrics';
import type { EventRow, SessionRow, UsageRow } from '../src/core/types';
import { lastNDates } from '../src/shared/datetime';

const u = (date: string, category: UsageRow['category'], host: string, seconds: number): UsageRow => ({ date, category, host, seconds });

describe('聚合', () => {
  const rows = [u('2026-10-14', 'german', 'learngerman.dw.com', 1200), u('2026-10-14', 'drift', 'live.bilibili.com', 1800), u('2026-10-13', 'drift', 'www.x.com', 600)];

  it('totalsByCategory / totalsByDate', () => {
    expect(totalsByCategory(rows)).toEqual({ german: 1200, study: 0, drift: 2400, other: 0 });
    expect(totalsByDate(rows).get('2026-10-13')?.drift).toBe(600);
  });

  it('topHosts 去 www 合并并标注主类别', () => {
    const top = topHosts([...rows, u('2026-10-14', 'drift', 'x.com', 100)], 2);
    expect(top).toEqual([
      { host: 'live.bilibili.com', seconds: 1800, category: 'drift' },
      { host: 'learngerman.dw.com', seconds: 1200, category: 'german' },
    ]);
  });
});

describe('germanStreak', () => {
  const dates = lastNDates('2026-10-14', 5); // 10-10 … 10-14
  const goal = 45 * 60;
  const byDate = (german: Record<string, number>) => totalsByDate(Object.entries(german).map(([d, m]) => u(d, 'german', 'a', m * 60)));

  it('从昨天往回数，今天达标再 +1', () => {
    expect(germanStreak(byDate({ '2026-10-12': 50, '2026-10-13': 45, '2026-10-14': 60 }), dates, goal)).toBe(3);
  });
  it('今天未达标不打断', () => {
    expect(germanStreak(byDate({ '2026-10-12': 50, '2026-10-13': 45, '2026-10-14': 10 }), dates, goal)).toBe(2);
  });
  it('昨天断档 → 只看今天', () => {
    expect(germanStreak(byDate({ '2026-10-12': 50, '2026-10-14': 60 }), dates, goal)).toBe(1);
  });
});

describe('nightStats', () => {
  const sched = { windDown: 1350, bedtime: 1380, wake: 450 };
  it('最后上网相对就寝的分钟数；次日首次上网对起床', () => {
    const days = [
      { date: '2026-10-13', firstAt: new Date(2026, 9, 13, 8, 0).getTime(), lastAt: new Date(2026, 9, 14, 0, 47).getTime() },
      { date: '2026-10-14', firstAt: new Date(2026, 9, 14, 7, 40).getTime(), lastAt: new Date(2026, 9, 14, 22, 50).getTime() },
    ];
    const [n13, n14] = nightStats(days, ['2026-10-13', '2026-10-14'], sched, 5);
    expect(n13).toMatchObject({ lateMin: 107, firstNextAt: days[1]!.firstAt, wakeAt: new Date(2026, 9, 14, 7, 30).getTime() });
    expect(n14).toMatchObject({ lateMin: -10, firstNextAt: null });
  });
  it('无数据的晚上 lateMin = null', () => {
    expect(nightStats([], ['2026-10-12'], sched, 5)[0]?.lateMin).toBeNull();
  });
});

describe('timeline', () => {
  it('相邻同类块（间隔 ≤ 2 分钟）合并，位置按逻辑日归一', () => {
    const base = new Date(2026, 9, 14, 5, 0).getTime();
    const seg = (startMin: number, endMin: number, category: SessionRow['category']): SessionRow => ({
      id: `${startMin}`,
      segId: `${startMin}`,
      date: '2026-10-14',
      start: base + startMin * 60_000,
      end: base + endMin * 60_000,
      host: 'h',
      url: 'https://h/',
      category,
      source: 'rule',
      incognito: false,
    });
    const blocks = timeline([seg(0, 60, 'german'), seg(61, 120, 'german'), seg(180, 240, 'drift')], '2026-10-14', 5);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.from).toBe(0);
    expect(blocks[0]!.to).toBeCloseTo(120 / 1440);
    expect(blocks[1]!.category).toBe('drift');
  });
});

describe('intentSummary', () => {
  it('说要看多久 vs 实际看了多久（按站点）', () => {
    const events: EventRow[] = [
      { date: '2026-10-14', at: 1, type: 'pass', site: 'bilibili.com', intent: '放松一下', minutes: 10 },
      { date: '2026-10-14', at: 2, type: 'pass', site: 'bilibili.com', intent: '看比赛', minutes: 20 },
      { date: '2026-10-14', at: 3, type: 'go-german' },
    ];
    const usage = [u('2026-10-14', 'drift', 'live.bilibili.com', 2400), u('2026-10-14', 'drift', 'x.com', 300), u('2026-10-14', 'german', 'www.bilibili.com', 900)];
    const [bili, x] = intentSummary(events, usage);
    expect(bili).toMatchObject({ site: 'bilibili.com', grantedMin: 30, actualMin: 40 });
    expect(bili!.entries).toHaveLength(2);
    expect(x).toMatchObject({ site: 'x.com', grantedMin: 0, actualMin: 5 });
  });
});
