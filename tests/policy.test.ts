import { describe, expect, it } from 'vitest';
import { checkCurfewExt, checkGrant, checkPrivateGrant, decide, gateWait, passOptions, type PolicyInput } from '../src/core/policy';
import type { CategoryId } from '../src/core/types';

const settings: PolicyInput['settings'] = {
  schedule: { windDown: 22 * 60 + 30, bedtime: 23 * 60, wake: 7 * 60 + 30 },
  driftCapMin: 60,
  passOptionsMin: [5, 10, 20],
  curfewAllow: { categories: ['german', 'study'], hosts: ['outlook.live.com'] },
  curfewExtPerNight: 1,
  privateCooldownSec: 180,
  privatePassMin: 20,
  privatePerDay: 1,
};

const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m).getTime();

function input(over: Partial<PolicyInput> & { category: CategoryId }): PolicyInput {
  return {
    now: at(14),
    settings,
    host: 'example.com',
    driftUsedSec: 0,
    passesToday: 0,
    curfewExtUsed: 0,
    privateUsed: 0,
    ...over,
  };
}

describe('判决表（architecture §5）', () => {
  const cases: Array<[string, Partial<PolicyInput> & { category: CategoryId }, string]> = [
    ['白天 · 非娱乐 → 放行', { category: 'german' }, 'allow'],
    ['白天 · 娱乐无通行证 → 闸门', { category: 'drift' }, 'gate'],
    ['白天 · 娱乐通行证有效 → 放行', { category: 'drift', pass: pass(at(13, 55), at(14, 5)) }, 'allow:pass'],
    ['白天 · 通行证刚过期 → 时间到', { category: 'drift', pass: pass(at(13, 40), at(13, 50)) }, 'block:expired'],
    ['白天 · 通行证过期很久 → 重新闸门', { category: 'drift', pass: pass(at(9), at(9, 10)) }, 'gate'],
    ['白天 · 额度用完 → 封顶（即使有通行证）', { category: 'drift', driftUsedSec: 3600, pass: pass(at(13, 55), at(14, 5)) }, 'block:cap'],
    ['收尾 · 娱乐 → 拦截', { category: 'drift', now: at(22, 40) }, 'block:winddown'],
    ['收尾 · 其他 → 放行 + 倒计时', { category: 'other', now: at(22, 40) }, 'allow:winddown'],
    ['宵禁 · 娱乐 → 拦截', { category: 'drift', now: at(23, 30) }, 'block:curfew'],
    ['宵禁 · 德语（白名单类别）→ 放行 + 已晚', { category: 'german', now: at(23, 30) }, 'allow:late'],
    ['宵禁 · 白名单 host → 放行', { category: 'other', host: 'outlook.live.com', now: at(23, 30) }, 'allow:late'],
    ['宵禁 · 其他 → 拦截', { category: 'other', now: at(23, 30) }, 'block:curfew'],
    ['宵禁 · 延长期内 → 放行', { category: 'other', now: at(23, 30), curfewExtUntil: at(23, 35) }, 'allow:ext'],
    ['宵禁 · 延长期内娱乐仍拦截', { category: 'drift', now: at(23, 30), curfewExtUntil: at(23, 35) }, 'block:curfew'],
    ['凌晨（跨午夜）仍是宵禁', { category: 'other', now: at(3) }, 'block:curfew'],
    ['07:30 起床后回到白天', { category: 'drift', now: at(7, 30) }, 'gate'],
    ['22:29 仍是白天', { category: 'drift', now: at(22, 29) }, 'gate'],
  ];
  it.each(cases)('%s', (_name, over, expected) => {
    const v = decide(input(over));
    const label = v.kind === 'allow' ? (v.banner ? `allow:${v.banner.kind}` : 'allow') : v.kind === 'block' ? `block:${v.reason}` : v.kind;
    expect(label).toBe(expected);
  });

  it('私密站点白天：冷静期（带时长与次数）', () => {
    expect(decide(input({ category: 'private' }))).toEqual({ kind: 'cooldown', waitSec: 180, passMin: 20, usedToday: 0, limit: 1 });
  });

  it.each<[string, Partial<PolicyInput>, string]>([
    ['今日次数用完 → 拦截', { privateUsed: 1 }, 'block:private-limit'],
    ['通行证有效 → 放行', { pass: pass(at(13, 55), at(14, 5)) }, 'allow:pass'],
    ['通行证到期 → 时间到', { pass: pass(at(13, 30), at(13, 50)) }, 'block:expired'],
    ['收尾期 → 拦截', { now: at(22, 40) }, 'block:winddown'],
    ['宵禁 → 拦截且不可延长（即使延长有效）', { now: at(23, 30), curfewExtUntil: at(23, 35) }, 'block:curfew'],
    ['宵禁白名单不放行私密（即使类别被误加入白名单）', { now: at(23, 30), settings: { ...settings, curfewAllow: { categories: ['private'], hosts: [] } } }, 'block:curfew'],
  ])('私密：%s', (_n, over, expected) => {
    const v = decide(input({ category: 'private', ...over }));
    const label = v.kind === 'allow' ? `allow:${v.banner?.kind}` : v.kind === 'block' ? `block:${v.reason}` : v.kind;
    expect(label).toBe(expected);
  });

  it('私密到期后：今天还有次数才可再申请；娱乐额度不影响私密', () => {
    const expired = pass(at(13, 30), at(13, 50));
    expect(decide(input({ category: 'private', pass: expired }))).toMatchObject({ canRetry: true });
    expect(decide(input({ category: 'private', pass: expired, privateUsed: 1 }))).toMatchObject({ canRetry: false });
    expect(decide(input({ category: 'private', driftUsedSec: 99_999 })).kind).toBe('cooldown');
  });

  it('checkPrivateGrant：冷静期满才放行', () => {
    const i = input({ category: 'private' });
    expect(checkPrivateGrant(i, i.now - 180_000)).toEqual({ ok: true });
    expect(checkPrivateGrant(i, i.now - 60_000)).toEqual({ ok: false, reason: 'too-early' });
    expect(checkPrivateGrant({ ...i, privateUsed: 1 }, i.now - 999_000)).toEqual({ ok: false, reason: 'not-cooldown' });
  });

  it('宵禁拦截：今晚还有延长次数才可延长；娱乐永不可延长', () => {
    const v1 = decide(input({ category: 'other', now: at(23, 30) }));
    const v2 = decide(input({ category: 'other', now: at(23, 30), curfewExtUsed: 1 }));
    const v3 = decide(input({ category: 'drift', now: at(23, 30) }));
    expect(v1).toMatchObject({ canExtend: true });
    expect(v2).toMatchObject({ canExtend: false });
    expect(v3).toMatchObject({ canExtend: false });
  });

  it('收尾期横幅给出今晚就寝时刻；宵禁横幅给出已晚起点', () => {
    expect(decide(input({ category: 'other', now: at(22, 40) }))).toEqual({ kind: 'allow', banner: { kind: 'winddown', bedtimeAt: at(23) } });
    expect(decide(input({ category: 'german', now: at(23, 30) }))).toEqual({ kind: 'allow', banner: { kind: 'late', since: at(23) } });
  });
});

describe('闸门参数', () => {
  it('等待秒数逐次递增并封顶', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(gateWait)).toEqual([5, 10, 20, 30, 45, 60, 60]);
  });

  it('档位不超过剩余额度；不足最小档时给剩余分钟', () => {
    expect(passOptions([5, 10, 20], 60)).toEqual([5, 10, 20]);
    expect(passOptions([20, 5, 10, 10], 12)).toEqual([5, 10]);
    expect(passOptions([5, 10, 20], 3)).toEqual([3]);
    expect(passOptions([5, 10, 20], 0)).toEqual([]);
  });

  it('闸门判决携带剩余额度与当天次数', () => {
    expect(decide(input({ category: 'drift', driftUsedSec: 50 * 60, passesToday: 2 }))).toEqual({
      kind: 'gate',
      waitSec: 20,
      options: [5, 10],
      passesToday: 2,
      driftLeftMin: 10,
    });
  });
});

describe('checkGrant', () => {
  const base = input({ category: 'drift' });
  it('等够、档位合法、写了意图 → 通过', () => {
    expect(checkGrant(base, 10, '看一场比赛', base.now - 5000)).toEqual({ ok: true });
  });
  it('没等够 / 从未展示闸门 → too-early', () => {
    expect(checkGrant(base, 10, 'x', base.now - 2000)).toEqual({ ok: false, reason: 'too-early' });
    expect(checkGrant(base, 10, 'x', undefined)).toEqual({ ok: false, reason: 'too-early' });
  });
  it('档位不在可选项 → bad-minutes；空意图 → no-intent', () => {
    expect(checkGrant(base, 30, 'x', base.now - 9000)).toEqual({ ok: false, reason: 'bad-minutes' });
    expect(checkGrant(base, 5, '  ', base.now - 9000)).toEqual({ ok: false, reason: 'no-intent' });
  });
  it('不在闸门状态（收尾期 / 已有通行证）→ not-gated', () => {
    expect(checkGrant({ ...base, now: at(22, 45) }, 5, 'x', at(22, 44))).toEqual({ ok: false, reason: 'not-gated' });
  });
});

describe('checkCurfewExt', () => {
  const night = input({ category: 'other', now: at(23, 30) });
  it('理由足够长 → 通过；太短 → short-reason', () => {
    expect(checkCurfewExt(night, '交作业截止')).toEqual({ ok: true });
    expect(checkCurfewExt(night, '看看')).toEqual({ ok: false, reason: 'short-reason' });
  });
  it('今晚已用完 → exhausted；白天 → not-blocked', () => {
    expect(checkCurfewExt({ ...night, curfewExtUsed: 1 }, '交作业截止')).toEqual({ ok: false, reason: 'exhausted' });
    expect(checkCurfewExt({ ...night, now: at(14) }, '交作业截止')).toEqual({ ok: false, reason: 'not-blocked' });
  });
});

function pass(grantedAt: number, until: number) {
  return { site: 'bilibili.com', intent: 'x', minutes: 10, grantedAt, until };
}
