import { hostInList } from './classify';
import { lastOccurrence, nextOccurrence, phaseAt } from './schedule';
import type { Banner, BlockReason, CategoryId, Pass, Settings, Verdict } from './types';

/**
 * 时段策略（纯函数）——判决表见 docs/design/architecture.md §5。
 * SW 只负责收集输入、执行判决，不做任何业务判断。
 */

/** 闸门等待秒数：当天第 n 次申请（0 起）递增 */
export const GATE_WAITS = [5, 10, 20, 30, 45, 60] as const;

/** 通行证过期后多久内回访仍显示"时间到"（之后视为新的一次进入，直接走闸门） */
export const EXPIRED_WINDOW_MS = 2 * 3_600_000;

export const MIN_REASON_LEN = 4;

export interface PolicyInput {
  now: number;
  settings: Pick<
    Settings,
    'schedule' | 'driftCapMin' | 'passOptionsMin' | 'curfewAllow' | 'curfewExtPerNight' | 'privateCooldownSec' | 'privatePassMin' | 'privatePerDay'
  >;
  category: CategoryId;
  host: string;
  /** 本站点最近一张通行证（可能已过期） */
  pass?: Pass;
  /** 今日娱乐已用秒数（含未落库的实时部分） */
  driftUsedSec: number;
  passesToday: number;
  curfewExtUntil?: number;
  curfewExtUsed: number;
  /** 今日已进入私密站点的次数 */
  privateUsed: number;
}

export function decide(i: PolicyInput): Verdict {
  const { schedule } = i.settings;
  const phase = phaseAt(i.now, schedule);

  // 娱乐与私密在夜间同等对待：拦截且不可延长
  const night = i.category === 'drift' || i.category === 'private';

  if (phase === 'curfew') {
    if (night) return block('curfew', false, false);
    if (curfewAllowed(i)) return allow({ kind: 'late', since: lastOccurrence(i.now, schedule.bedtime) });
    if (i.curfewExtUntil !== undefined && i.curfewExtUntil > i.now) return allow({ kind: 'ext', until: i.curfewExtUntil });
    return block('curfew', i.curfewExtUsed < i.settings.curfewExtPerNight, false);
  }

  if (phase === 'winddown') {
    if (night) return block('winddown', false, false);
    return allow({ kind: 'winddown', bedtimeAt: nextOccurrence(i.now, schedule.bedtime) });
  }

  if (i.category === 'private') return decidePrivate(i);
  if (i.category !== 'drift') return { kind: 'allow' };
  const capSec = i.settings.driftCapMin * 60;
  if (i.driftUsedSec >= capSec) return block('cap', false, false);
  if (i.pass) {
    if (i.pass.until > i.now) return allow({ kind: 'pass', until: i.pass.until });
    if (i.now - i.pass.until < EXPIRED_WINDOW_MS) return block('expired', false, true);
  }
  const leftMin = Math.floor((capSec - i.driftUsedSec) / 60);
  return {
    kind: 'gate',
    waitSec: gateWait(i.passesToday),
    options: passOptions(i.settings.passOptionsMin, leftMin),
    passesToday: i.passesToday,
    driftLeftMin: leftMin,
  };
}

/** 白天的私密站点：通行证 → 时间到 → 每日次数 → 冷静期 */
function decidePrivate(i: PolicyInput): Verdict {
  const s = i.settings;
  const left = i.privateUsed < s.privatePerDay;
  if (i.pass) {
    if (i.pass.until > i.now) return allow({ kind: 'pass', until: i.pass.until });
    if (i.now - i.pass.until < EXPIRED_WINDOW_MS) return block('expired', false, left);
  }
  if (!left) return block('private-limit', false, false);
  return { kind: 'cooldown', waitSec: s.privateCooldownSec, passMin: s.privatePassMin, usedToday: i.privateUsed, limit: s.privatePerDay };
}

export function gateWait(passesToday: number): number {
  return GATE_WAITS[Math.min(passesToday, GATE_WAITS.length - 1)]!;
}

/** 时长档位不超过剩余额度；剩余不足最小档时给出"剩余分钟"一档 */
export function passOptions(configured: number[], leftMin: number): number[] {
  const opts = [...new Set(configured)].filter((m) => m > 0 && m <= leftMin).sort((a, b) => a - b);
  if (opts.length === 0 && leftMin >= 1) return [leftMin];
  return opts;
}

export type GrantCheck = { ok: true } | { ok: false; reason: 'not-gated' | 'bad-minutes' | 'too-early' | 'no-intent' };

/** 发通行证的校验：此刻必须处于闸门、档位合法、已等够、写了意图 */
export function checkGrant(i: PolicyInput, minutes: number, intent: string, gateShownAt: number | undefined): GrantCheck {
  const v = decide(i);
  if (v.kind !== 'gate') return { ok: false, reason: 'not-gated' };
  if (!v.options.includes(minutes)) return { ok: false, reason: 'bad-minutes' };
  if (intent.trim() === '') return { ok: false, reason: 'no-intent' };
  // 1s 容差：content 端倒计时与 SW 时钟的往返误差
  if (gateShownAt === undefined || i.now - gateShownAt < v.waitSec * 1000 - 1000) return { ok: false, reason: 'too-early' };
  return { ok: true };
}

export type PrivateCheck = { ok: true } | { ok: false; reason: 'not-cooldown' | 'too-early' };

/** 私密站点放行：此刻必须处于冷静期判决，且冷静期已满 */
export function checkPrivateGrant(i: PolicyInput, shownAt: number | undefined): PrivateCheck {
  const v = decide(i);
  if (v.kind !== 'cooldown') return { ok: false, reason: 'not-cooldown' };
  if (shownAt === undefined || i.now - shownAt < v.waitSec * 1000 - 1000) return { ok: false, reason: 'too-early' };
  return { ok: true };
}

export type ExtendCheck = { ok: true } | { ok: false; reason: 'not-blocked' | 'exhausted' | 'short-reason' };

export function checkCurfewExt(i: PolicyInput, reason: string): ExtendCheck {
  const v = decide(i);
  if (v.kind !== 'block' || v.reason !== 'curfew') return { ok: false, reason: 'not-blocked' };
  if (!v.canExtend) return { ok: false, reason: 'exhausted' };
  if (reason.trim().length < MIN_REASON_LEN) return { ok: false, reason: 'short-reason' };
  return { ok: true };
}

function curfewAllowed(i: PolicyInput): boolean {
  if (i.category === 'private') return false;
  return i.settings.curfewAllow.categories.includes(i.category) || hostInList(i.host, i.settings.curfewAllow.hosts);
}

function allow(banner: Banner): Verdict {
  return { kind: 'allow', banner };
}

function block(reason: BlockReason, canExtend: boolean, canRetry: boolean): Verdict {
  return { kind: 'block', reason, canExtend, canRetry };
}
