import { describe, expect, it } from 'vitest';
import { dateKey, nextDayBoundary, splitByDay } from '../src/shared/datetime';

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
