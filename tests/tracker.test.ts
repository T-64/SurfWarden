import { describe, expect, it } from 'vitest';
import { makeClassifier } from '../src/core/classify';
import { initialState, liveSeconds, step } from '../src/core/tracker';
import type { Piece, TrackerDeps, TrackerEvent, TrackerState } from '../src/core/types';

const deps: TrackerDeps = {
  idleGraceSec: 60,
  idleThresholdSec: 120,
  dayCutoffHour: 5,
  classify: makeClassifier(
    [
      { id: 'r1', pattern: 'drift.test', category: 'drift', createdAt: 1 },
      { id: 'r2', pattern: 'german.test', category: 'german', createdAt: 2 },
      { id: 'r3', pattern: 'bilibili.com', category: 'drift', createdAt: 3 },
    ],
    [{ platform: 'bilibili', id: '123', name: '德语老师', category: 'german' }],
  ),
};

const T0 = new Date(2026, 9, 14, 10, 0, 0).getTime();
const s = (sec: number) => T0 + sec * 1000;

function run(events: TrackerEvent[], from: TrackerState = initialState()) {
  let state = from;
  const pieces: Piece[] = [];
  for (const ev of events) {
    const r = step(state, ev, deps);
    state = r.state;
    pieces.push(...r.pieces);
  }
  return { state, pieces };
}

const act = (tabId: number, url: string, at: number, extra: Partial<{ windowId: number; audible: boolean; title: string }> = {}): TrackerEvent => ({
  type: 'tab-activated',
  windowId: extra.windowId ?? 1,
  tabId,
  url,
  title: extra.title,
  incognito: false,
  audible: extra.audible,
  at,
});
const upd = (tabId: number, url: string, at: number, extra: Partial<{ windowId: number; audible: boolean; title: string }> = {}): TrackerEvent => ({
  type: 'tab-updated',
  windowId: extra.windowId ?? 1,
  tabId,
  url,
  title: extra.title,
  incognito: false,
  audible: extra.audible,
  at,
});
const hb = (at: number): TrackerEvent => ({ type: 'heartbeat', at });
const heartbeats = (fromSec: number, toSec: number) => {
  const out: TrackerEvent[] = [];
  for (let t = fromSec; t <= toSec; t += 30) out.push(hb(s(t)));
  return out;
};
const sec = (ps: Piece[], cat?: string) =>
  ps.filter((p) => !cat || p.category === cat).reduce((a, p) => a + (p.end - p.start) / 1000, 0);

describe('开段与切换', () => {
  it('激活 → 切标签：前一段按切换时刻关闭', () => {
    const { pieces, state } = run([act(1, 'https://drift.test/a', s(0)), act(2, 'https://german.test/', s(40))]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ category: 'drift', start: s(0), end: s(40), host: 'drift.test' });
    expect(state.current).toMatchObject({ tabId: 2, category: 'german' });
  });

  it('同 URL 只改标题不切段', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/a', s(0), { title: 'x' }),
      upd(1, 'https://drift.test/a', s(10), { title: 'y' }),
    ]);
    expect(pieces).toHaveLength(0);
    expect(state.current?.title).toBe('y');
  });

  it('非 http(s) 不计时', () => {
    const { state } = run([act(1, 'chrome://newtab/', s(0))]);
    expect(state.current).toBeNull();
  });

  it('所有窗口失焦关段，回焦重开', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/a', s(0)),
      { type: 'window-focus', windowId: -1, at: s(20) },
      { type: 'window-focus', windowId: 1, at: s(50) },
    ]);
    expect(sec(pieces)).toBe(20);
    expect(state.current?.startedAt).toBe(s(50));
  });

  it('非聚焦窗口的标签更新不影响当前段', () => {
    const { pieces, state } = run([
      act(9, 'https://german.test/', s(0), { windowId: 2 }),
      act(1, 'https://drift.test/a', s(5)),
      upd(9, 'https://german.test/next', s(10), { windowId: 2 }),
    ]);
    expect(sec(pieces, 'german')).toBe(5);
    expect(state.current?.tabId).toBe(1);
  });

  it('跨逻辑日（05:00）拆成两片', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 15, h, m).getTime();
    const beats = [30, 60, 90, 120, 150].map((d) => hb(at(4, 58) + d * 1000));
    const { pieces } = run([act(1, 'https://drift.test/', at(4, 58)), ...beats, act(2, 'https://german.test/', at(5, 1))]);
    expect([...new Set(pieces.map((p) => p.date))]).toEqual(['2026-10-14', '2026-10-15']);
    expect(sec(pieces)).toBe(180);
  });
});

describe('心跳落库（ADR-0014）', () => {
  it('落库线停在 now − idle 阈值；实时读数补上余量', () => {
    const { pieces, state } = run([act(1, 'https://drift.test/', s(0)), ...heartbeats(30, 300)]);
    expect(sec(pieces)).toBe(180);
    expect(new Set(pieces.map((p) => p.segId)).size).toBe(1);
    expect(liveSeconds(state, s(300))).toBe(120);
  });

  it('合盖休眠后先到 idle→active：空窗不计入，从唤醒时刻重开', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/', s(0)),
      hb(s(30)),
      { type: 'idle-changed', state: 'active', at: s(3600) },
    ]);
    expect(sec(pieces)).toBe(90);
    expect(state.current?.startedAt).toBe(s(3600));
  });

  it('SW 重启后的对账不前移水位', () => {
    const r = run([act(1, 'https://drift.test/', s(0)), hb(s(30))]);
    const { pieces } = run(
      [
        { type: 'sync', at: s(900), focusedWindowId: 1, idleState: 'active', tabs: [{ windowId: 1, tabId: 1, url: 'https://drift.test/', incognito: false }] },
        hb(s(930)),
      ],
      r.state,
    );
    expect(sec([...r.pieces, ...pieces])).toBe(90);
  });

  it('心跳断档（SW 被杀 / 休眠）：按水位 + 宽限截断，然后重开', () => {
    const { pieces, state } = run([act(1, 'https://drift.test/', s(0)), hb(s(30)), hb(s(600))]);
    expect(sec(pieces)).toBe(90); // 水位 30 + 宽限 60
    expect(state.current?.startedAt).toBe(s(600));
  });
});

describe('idle 与媒体证据', () => {
  it('无媒体：idle 关段并回溯一个阈值，已落库部分不重复', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/', s(0)),
      ...heartbeats(30, 180),
      { type: 'idle-changed', state: 'idle', at: s(200) },
    ]);
    expect(sec(pieces)).toBe(80);
    expect(state.current).toBeNull();
  });

  it('标签页在出声：idle 不停表，声音停止时关段', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/live', s(0), { audible: true }),
      ...heartbeats(30, 120),
      { type: 'idle-changed', state: 'idle', at: s(130) },
      ...heartbeats(150, 900),
      upd(1, 'https://drift.test/live', s(910), { audible: false }),
    ]);
    expect(state.current).toBeNull();
    expect(sec(pieces)).toBe(910);
  });

  it('content 报告视频在播（静音也算）：idle 不停表', () => {
    const { state } = run([
      act(1, 'https://drift.test/v', s(0)),
      { type: 'page', tabId: 1, page: { url: 'https://drift.test/v', mediaPlaying: true }, at: s(5) },
      { type: 'idle-changed', state: 'idle', at: s(130) },
    ]);
    expect(state.current?.tabId).toBe(1);
  });

  it('页面信号 URL 不匹配时失效（SPA 跳走后旧信号不算）', () => {
    const { state } = run([
      act(1, 'https://drift.test/v', s(0)),
      { type: 'page', tabId: 1, page: { url: 'https://drift.test/v', mediaPlaying: true }, at: s(5) },
      upd(1, 'https://drift.test/other', s(10)),
      { type: 'idle-changed', state: 'idle', at: s(130) },
    ]);
    expect(state.current).toBeNull();
  });

  it('锁屏一律停表（即使在出声）', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/live', s(0), { audible: true }),
      { type: 'idle-changed', state: 'locked', at: s(40) },
    ]);
    expect(state.current).toBeNull();
    expect(sec(pieces)).toBe(40);
  });

  it('idle 恢复 active 时重开', () => {
    const { state } = run([
      act(1, 'https://drift.test/', s(0)),
      { type: 'idle-changed', state: 'idle', at: s(130) },
      { type: 'idle-changed', state: 'active', at: s(500) },
    ]);
    expect(state.current?.startedAt).toBe(s(500));
  });
});

describe('分类变化在同一页面上生效', () => {
  it('频道信号到达：B 站德语 UP 主 → 当场改判为德语', () => {
    const url = 'https://www.bilibili.com/video/BV1';
    const { pieces, state } = run([
      act(1, url, s(0)),
      { type: 'page', tabId: 1, page: { url, channel: { platform: 'bilibili', id: '123', name: '德语老师' } }, at: s(8) },
    ]);
    expect(pieces).toEqual([expect.objectContaining({ category: 'drift', end: s(8) })]);
    expect(state.current).toMatchObject({ category: 'german', source: 'channel' });
  });

  it('未知频道：类别不变，不切段，只记下频道', () => {
    const url = 'https://www.bilibili.com/video/BV2';
    const { pieces, state } = run([
      act(1, url, s(0)),
      { type: 'page', tabId: 1, page: { url, channel: { platform: 'bilibili', id: '999', name: '游戏区' } }, at: s(8) },
    ]);
    expect(pieces).toHaveLength(0);
    expect(state.current?.channel?.id).toBe('999');
  });

  it('手动改判只作用于该标签的该 URL', () => {
    const { pieces, state } = run([
      act(1, 'https://drift.test/a', s(0)),
      { type: 'override', override: { tabId: 1, url: 'https://drift.test/a', category: 'german' }, at: s(10) },
      upd(1, 'https://drift.test/b', s(20)),
    ]);
    expect(pieces.map((p) => [p.category, p.source])).toEqual([
      ['drift', 'rule'],
      ['german', 'manual'],
    ]);
    expect(state.current?.category).toBe('drift');
  });
});
