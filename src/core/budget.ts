import type { Category, UsageRow } from './types';

/**
 * 预算与监督决策（纯函数）——语义见 docs/design/key-algorithms.md §3。
 * 全部判定在此，adapter/background 只做执行，不做业务判断（dev-process §2）。
 */

export type BudgetState = 'ok' | 'warn' | 'exhausted';

export const WARN_RATIO = 0.8;

/** 预算状态：undefined 预算 = 正向类，永远 ok；预算 0 = 一有使用即耗尽 */
export function budgetState(
  usedSec: number,
  budgetMin: number | undefined,
  warnRatio: number = WARN_RATIO,
): BudgetState {
  if (budgetMin === undefined) return 'ok';
  if (budgetMin <= 0) return usedSec > 0 ? 'exhausted' : 'ok';
  const budgetSec = budgetMin * 60;
  if (usedSec >= budgetSec) return 'exhausted';
  if (usedSec >= budgetSec * warnRatio) return 'warn';
  return 'ok';
}

/** 日用量按类别聚合（rows 已是单日数据） */
export function usageByCategory(rows: UsageRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + r.seconds);
  }
  return out;
}

export interface SupervisionDecision {
  /** 在检查点弹非侵入横幅（warn 起步；transition 去重由 SW 负责） */
  banner: boolean;
  /** 重定向引导页 */
  block: boolean;
}

/**
 * 监督矩阵（PRODUCT.md §3.4 四档）：
 * track：只统计；nudge：warn 起横幅，不封锁；budget：warn 横幅 + exhausted 封锁；
 * hard：无条件封锁。pauseUntil 生效期间只统计不干预。
 */
export function supervise(
  category: Category,
  state: BudgetState,
  pauseUntil: number | undefined,
  now: number,
): SupervisionDecision {
  if (pauseUntil !== undefined && now < pauseUntil) return { banner: false, block: false };
  switch (category.action) {
    case 'hard':
      return { banner: false, block: true };
    case 'budget':
      return { banner: state !== 'ok', block: state === 'exhausted' };
    case 'nudge':
      return { banner: state === 'warn' || state === 'exhausted', block: false };
    case 'track':
    default:
      return { banner: false, block: false };
  }
}

/** 豁免资格：当日剩余次数 > 0 */
export function canExempt(usedToday: number, exemptPerDay: number): boolean {
  return usedToday < exemptPerDay;
}
