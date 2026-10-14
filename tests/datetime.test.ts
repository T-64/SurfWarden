import { describe, expect, it } from 'vitest';
import { addDays, dateKey, dayRange, lastNDates, logicalDayAt, nextDayBoundary, splitByDay } from '../src/shared/datetime';
import { clockHM, formatMin, hhmm, mmss } from '../src/shared/format';

/** 本地时区安全的固定时刻构造（测试结果与运行环境时区无关） */
function localTs(y: number, m: number, d: number, h: number, min = 0, s = 0): number {
  return new Date(y, m - 1, d, h, min, s, 0).getTime();
}

describe('dateKey', () => {
  it('cutoff=0 时就是本地日', () => {
    expect(dateKey(localTs(2026, 9, 6, 10, 0), 0)).toBe('2026-09-06');
    expect(dateKey(localTs(2026, 9, 6, 23, 59), 0)).toBe('2026-09-06');
    expect(dateKey(localTs(2026, 9, 7, 0, 0), 0)).toBe('2026-09-07');
  });

  it('cutoff=4 时凌晨 0–3:59 归前一天', () => {
    expect(dateKey(localTs(2026, 9, 7, 2, 0), 4)).toBe('2026-09-06');
    expect(dateKey(localTs(2026, 9, 7, 3, 59), 4)).toBe('2026-09-06');
    expect(dateKey(localTs(2026, 9, 7, 4, 0), 4)).toBe('2026-09-07');
  });

  it('跨月/跨年正常', () => {
    expect(dateKey(localTs(2026, 10, 1, 2, 0), 4)).toBe('2026-09-30');
    expect(dateKey(localTs(2027, 1, 1, 1, 0), 4)).toBe('2026-12-31');
  });
});

describe('nextDayBoundary', () => {
  it('返回当天或次日的 cutoff 时刻', () => {
    expect(nextDayBoundary(localTs(2026, 9, 6, 10), 0)).toBe(localTs(2026, 9, 7, 0));
    expect(nextDayBoundary(localTs(2026, 9, 6, 23, 59), 0)).toBe(localTs(2026, 9, 7, 0));
    expect(nextDayBoundary(localTs(2026, 9, 6, 2), 4)).toBe(localTs(2026, 9, 6, 4));
    expect(nextDayBoundary(localTs(2026, 9, 6, 5), 4)).toBe(localTs(2026, 9, 7, 4));
  });
});

describe('splitByDay', () => {
  const E12_23_58 = localTs(2026, 9, 6, 23, 58);
  const E12_00_03 = localTs(2026, 9, 7, 0, 3);

  it('同日不拆分', () => {
    const a = localTs(2026, 9, 6, 10);
    const b = localTs(2026, 9, 6, 11);
    expect(splitByDay(a, b, 0)).toEqual([{ date: '2026-09-06', start: a, end: b }]);
  });

  it('E12 跨零点拆两段，边界连续且无重叠', () => {
    expect(splitByDay(E12_23_58, E12_00_03, 0)).toEqual([
      { date: '2026-09-06', start: E12_23_58, end: localTs(2026, 9, 7, 0) },
      { date: '2026-09-07', start: localTs(2026, 9, 7, 0), end: E12_00_03 },
    ]);
  });

  it('cutoff=4 时跨凌晨 4 点才拆', () => {
    const a = localTs(2026, 9, 6, 23);
    const b = localTs(2026, 9, 7, 2);
    expect(splitByDay(a, b, 4)).toEqual([{ date: '2026-09-06', start: a, end: b }]);

    const c = localTs(2026, 9, 7, 1);
    const d = localTs(2026, 9, 7, 5);
    expect(splitByDay(c, d, 4)).toEqual([
      { date: '2026-09-06', start: c, end: localTs(2026, 9, 7, 4) },
      { date: '2026-09-07', start: localTs(2026, 9, 7, 4), end: d },
    ]);
  });

  it('start==end 返回空，start>end 返回空（防御）', () => {
    expect(splitByDay(E12_23_58, E12_23_58, 0)).toEqual([]);
    expect(splitByDay(E12_00_03, E12_23_58, 0)).toEqual([]);
  });
});

describe('v3 日历工具', () => {
  it('addDays / lastNDates 跨月', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(lastNDates('2026-10-02', 3)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('logicalDayAt：早于 cutoff 的时刻落在次日凌晨', () => {
    expect(logicalDayAt('2026-10-14', 23 * 60, 5)).toBe(new Date(2026, 9, 14, 23, 0).getTime());
    expect(logicalDayAt('2026-10-14', 30, 5)).toBe(new Date(2026, 9, 15, 0, 30).getTime());
  });

  it('dayRange：[当日 cutoff, 次日 cutoff)', () => {
    expect(dayRange('2026-10-14', 5)).toEqual([new Date(2026, 9, 14, 5).getTime(), new Date(2026, 9, 15, 5).getTime()]);
  });
});

describe('format', () => {
  it('formatMin / clockHM / mmss / hhmm', () => {
    expect(formatMin(0)).toBe('0 分钟');
    expect(formatMin(30)).toBe('<1 分钟');
    expect(formatMin(125 * 60)).toBe('2 小时 5 分');
    expect(clockHM(95 * 60_000)).toBe('1:35');
    expect(mmss(61_500)).toBe('1:01');
    expect(hhmm(new Date(2026, 9, 14, 7, 5).getTime())).toBe('07:05');
  });
});
