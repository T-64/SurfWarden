import { describe, expect, it } from 'vitest';
import { budgetState, canExempt, supervise, usageByCategory } from '../src/core/budget';
import type { Category, UsageRow } from '../src/core/types';

const cat = (action: Category['action'], budgetMin?: number): Category => ({
  id: 'entertainment',
  name: '娱乐',
  color: '#dc2626',
  budgetMin,
  action,
});

describe('budgetState', () => {
  it.each([
    [0, 45, 'ok'],
    [2159, 45, 'ok'], // < 80% (2160s)
    [2160, 45, 'warn'], // 恰好 80%
    [2699, 45, 'warn'],
    [2700, 45, 'exhausted'], // 恰好用满
    [5000, 45, 'exhausted'],
  ] as const)('%i 秒 / 预算 %i 分钟 → %s', (used, budget, expected) => {
    expect(budgetState(used, budget)).toBe(expected);
  });

  it('无预算（正向类）永远 ok', () => {
    expect(budgetState(999999, undefined)).toBe('ok');
  });

  it('预算 0：一有使用即耗尽，为 0 时 ok', () => {
    expect(budgetState(0, 0)).toBe('ok');
    expect(budgetState(1, 0)).toBe('exhausted');
  });
});

describe('usageByCategory', () => {
  it('同类多站点合并', () => {
    const rows: UsageRow[] = [
      { date: '2026-09-06', categoryId: 'entertainment', host: 'a.com', seconds: 60, visits: 1 },
      { date: '2026-09-06', categoryId: 'entertainment', host: 'b.com', seconds: 30, visits: 2 },
      { date: '2026-09-06', categoryId: 'learning', host: 'c.com', seconds: 600, visits: 1 },
    ];
    const m = usageByCategory(rows);
    expect(m.get('entertainment')).toBe(90);
    expect(m.get('learning')).toBe(600);
  });
});

describe('supervise 监督矩阵（PRODUCT.md §3.4）', () => {
  const NOW = 1_000_000;

  it.each([
    ['track', 'ok', undefined, { banner: false, block: false }],
    ['track', 'exhausted', undefined, { banner: false, block: false }],
    ['nudge', 'ok', undefined, { banner: false, block: false }],
    ['nudge', 'warn', undefined, { banner: true, block: false }],
    ['nudge', 'exhausted', undefined, { banner: true, block: false }],
    ['budget', 'warn', undefined, { banner: true, block: false }],
    ['budget', 'exhausted', undefined, { banner: true, block: true }],
    ['hard', 'ok', undefined, { banner: false, block: true }],
  ] as const)('%s @ %s 暂停=%s → %j', (action, state, pause, expected) => {
    expect(supervise(cat(action, 45), state, pause, NOW)).toEqual(expected);
  });

  it('暂停期间：一切封锁与横幅暂停（含 hard），只统计', () => {
    const until = NOW + 1_800_000;
    expect(supervise(cat('hard'), 'exhausted', until, NOW)).toEqual({ banner: false, block: false });
    expect(supervise(cat('budget'), 'exhausted', until, NOW)).toEqual({ banner: false, block: false });
  });

  it('暂停过期后恢复监督', () => {
    expect(supervise(cat('budget'), 'exhausted', NOW - 1, NOW)).toEqual({
      banner: true,
      block: true,
    });
  });
});

describe('canExempt', () => {
  it('次数未用完可豁免，用完不可', () => {
    expect(canExempt(0, 2)).toBe(true);
    expect(canExempt(1, 2)).toBe(true);
    expect(canExempt(2, 2)).toBe(false);
  });
});
