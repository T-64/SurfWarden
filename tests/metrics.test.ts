import { describe, expect, it } from 'vitest';
import {
  aggregateByDate,
  aggregateByHost,
  hourBuckets,
  lastNDates,
  learningStreak,
  learningToEntertainment,
  todayVsWeekAvg,
} from '../src/core/metrics';
import type { UsageRow } from '../src/core/types';

const row = (date: string, categoryId: string, seconds: number, host = 'a.com'): UsageRow => ({
  date,
  categoryId,
  host,
  seconds,
  visits: 1,
});

// 固定"今天"：2026-09-06 12:00 本地
const NOW = new Date(2026, 8, 6, 12, 0).getTime();

describe('lastNDates', () => {
  it('旧→新，含今天', () => {
    expect(lastNDates(3, 0, NOW)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06']);
  });
});

describe('aggregateByDate / aggregateByHost', () => {
  it('按日按类聚合、按站降序', () => {
    const rows = [
      row('2026-09-06', 'learning', 60),
      row('2026-09-06', 'learning', 30, 'b.com'),
      row('2026-09-06', 'work', 500, 'c.com'),
      row('2026-09-05', 'work', 120),
    ];
    const byDate = aggregateByDate(rows);
    expect(byDate.get('2026-09-06')?.get('learning')).toBe(90);
    expect(byDate.get('2026-09-05')?.get('work')).toBe(120);
    const hosts = aggregateByHost(rows);
    expect(hosts[0]).toEqual({ host: 'c.com', seconds: 500 });
    expect(hosts[hosts.length - 1]).toEqual({ host: 'b.com', seconds: 30 });
  });
});

describe('learningToEntertainment', () => {
  it('常规比值保留 1 位小数', () => {
    const m = new Map([['learning', 3600], ['entertainment', 1800]]);
    expect(learningToEntertainment(m)).toBe(2);
  });
  it('娱乐为 0 → null（显示 ∞）', () => {
    expect(learningToEntertainment(new Map([['learning', 100]]))).toBeNull();
  });
});

describe('learningStreak', () => {
  const rows = [
    row('2026-09-05', 'learning', 600),
    row('2026-09-04', 'learning', 599), // 差一秒，断
    row('2026-09-03', 'learning', 600),
  ];
  it('今天未达标不惩罚，从昨天回数', () => {
    expect(learningStreak(rows, 600, 0, NOW)).toBe(1);
  });
  it('今天达标 +1', () => {
    const withToday = [...rows, row('2026-09-06', 'learning', 1200)];
    expect(learningStreak(withToday, 600, 0, NOW)).toBe(2);
  });
  it('昨天断了 → 0', () => {
    expect(learningStreak([row('2026-09-03', 'learning', 600)], 600, 0, NOW)).toBe(0);
  });
});

describe('hourBuckets', () => {
  it('按段起始小时归桶', () => {
    const start = new Date(2026, 8, 6, 14, 10).getTime();
    const buckets = hourBuckets([{ start, end: start + 300_000 }]);
    expect(buckets[14]).toBe(300);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(300);
  });
});

describe('todayVsWeekAvg', () => {
  it('今天/过去6天均值', () => {
    // 7 日窗口 = [08-31 .. 09-06]；08-31 无数据（0），09-01..05 各 3600 → 均值 3000
    const rows: UsageRow[] = [1, 2, 3, 4, 5].map((i) => row(`2026-09-0${i}`, 'work', 3600));
    rows.push(row('2026-09-06', 'work', 6000));
    const dates = lastNDates(7, 0, NOW);
    expect(todayVsWeekAvg(rows, dates, 0, NOW)).toBe(2);
  });
  it('无历史 → null', () => {
    expect(todayVsWeekAvg([row('2026-09-06', 'work', 100)], lastNDates(7, 0, NOW), 0, NOW)).toBeNull();
  });
});
