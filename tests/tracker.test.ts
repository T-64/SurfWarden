import { describe, expect, it } from 'vitest';
import { initialState, step } from '../src/core/tracker';
import type {
  ClosedSegment,
  TrackerDeps,
  TrackerEvent,
  TrackerState,
} from '../src/core/types';

function localTs(h: number, m = 0, s = 0): number {
  // 固定基准日 2026-09-06，结果与时区无关
  return new Date(2026, 8, 6, h, m, s, 0).getTime();
}
const T0 = localTs(10);

const mkDeps = (cutoffHour = 0): TrackerDeps => ({
  idleGraceSec: 60,
  dayCutoffHour: cutoffHour,
  classify: (url) =>
    url.startsWith('chrome://')
      ? null
      : { categoryId: url.includes('twitter') ? 'entertainment' : 'neutral' },
});

const act = (
  tabId: number,
  windowId: number,
  url: string,
  at: number,
  incognito = false,
): TrackerEvent => ({ type: 'tab-activated', windowId, tabId, url, incognito, at });
const upd = (
  tabId: number,
  windowId: number,
  url: string,
  at: number,
): TrackerEvent => ({ type: 'tab-updated', windowId, tabId, url, incognito: false, at });
const hb = (at: number): TrackerEvent => ({ type: 'heartbeat', at });

function run(
  events: TrackerEvent[],
  deps: TrackerDeps = mkDeps(),
  init: TrackerState = initialState(),
): { state: TrackerState; closed: ClosedSegment[] } {
  let state = init;
  const closed: ClosedSegment[] = [];
  for (const ev of events) {
    const r = step(state, ev, deps);
    state = r.state;
    closed.push(...r.closed);
  }
  return { state, closed };
}

const TW = 'https://twitter.com/home';
const GH = 'https://github.com/tan';

describe('计时状态机（key-algorithms §1.3 边界表）', () => {
  it('E1 正常切换：旧段闭合、新段开启、边界连续', () => {
    const { state, closed } = run([act(1, 100, TW, T0), act(2, 100, GH, T0 + 60_000)]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      url: TW,
      host: 'twitter.com',
      categoryId: 'entertainment',
      start: T0,
      end: T0 + 60_000,
      endReason: 'event',
    });
    expect(state.current).toMatchObject({ tabId: 2, url: GH, categoryId: 'neutral' });
    expect(state.current?.startedAt).toBe(T0 + 60_000);
  });

  it('E2 单页久留 + 心跳：水位持续延长，时长如实累计', () => {
    const events: TrackerEvent[] = [act(1, 100, TW, T0)];
    for (let i = 1; i <= 10; i++) events.push(hb(T0 + i * 30_000));
    events.push(act(2, 100, GH, T0 + 330_000)); // 最后一个心跳 +300s，再过 30s 切走
    const { closed } = run(events);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.end - closed[0]!.start).toBe(330_000);
    expect(closed[0]!.endReason).toBe('event');
  });

  it('E3 SW 被杀 10 分钟：空窗被 cap 截断，恢复后重开新段', () => {
    const { closed } = run([
      act(1, 100, TW, T0),
      hb(T0 + 30_000),
      hb(T0 + 930_000), // 距水位 900s，证据断裂
      act(2, 100, GH, T0 + 960_000),
    ]);
    expect(closed).toHaveLength(2);
    expect(closed[0]!.end - closed[0]!.start).toBe(90_000); // 水位 30s + 宽限 60s
    expect(closed[0]!.endReason).toBe('cap');
    expect(closed[1]!.start).toBe(T0 + 930_000);
    expect(closed[1]!.end - closed[1]!.start).toBe(30_000);
  });

  it('E4 idle：段以 idle 关闭', () => {
    const { closed, state } = run([
      act(1, 100, TW, T0),
      hb(T0 + 30_000),
      { type: 'idle-changed', state: 'idle', at: T0 + 60_000 },
    ]);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.endReason).toBe('idle');
    expect(closed[0]!.end - closed[0]!.start).toBe(60_000);
    expect(state.current).toBeNull();
  });

  it('E5 idle 恢复：重新开段并重新分类', () => {
    const { state } = run([
      act(1, 100, TW, T0),
      { type: 'idle-changed', state: 'idle', at: T0 + 60_000 },
      { type: 'idle-changed', state: 'active', at: T0 + 600_000 },
    ]);
    expect(state.current).toMatchObject({ tabId: 1, url: TW, startedAt: T0 + 600_000 });
  });

  it('E6 全窗口失焦：段以 blur 关闭；失焦期间不产段', () => {
    const { state, closed } = run([
      act(1, 100, TW, T0),
      { type: 'window-focus', windowId: -1, at: T0 + 60_000 },
    ]);
    expect(closed[0]!.endReason).toBe('blur');
    expect(state.current).toBeNull();
    // 失焦期间的心跳不应产生任何段
    const after = run([hb(T0 + 120_000)], mkDeps(), { ...state, lastActiveAt: T0 + 60_000 });
    expect(after.closed).toHaveLength(0);
    expect(after.state.current).toBeNull();
  });

  it('E7 关闭 active tab：段闭合', () => {
    const { state, closed } = run([
      act(1, 100, TW, T0),
      { type: 'tab-removed', tabId: 1, at: T0 + 50_000 },
    ]);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.end).toBe(T0 + 50_000);
    expect(state.current).toBeNull();
  });

  it('E8 同 tab URL 变化：换段并重新分类', () => {
    const { state, closed } = run([
      act(1, 100, TW, T0),
      hb(T0 + 30_000),
      upd(1, 100, GH, T0 + 60_000),
    ]);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.url).toBe(TW);
    expect(state.current).toMatchObject({ url: GH, startedAt: T0 + 60_000 });
  });

  it('E9 浏览器重启残留段：按水位截断入库后不再重开（等 sync 决定）', () => {
    const dirty: TrackerState = {
      focusedWindowId: 100,
      activeTabs: { 100: { tabId: 1, url: TW, incognito: false } },
      current: {
        windowId: 100,
        tabId: 1,
        url: TW,
        host: 'twitter.com',
        incognito: false,
        categoryId: 'entertainment',
        startedAt: T0,
      },
      lastActiveAt: T0 + 30_000,
    };
    const { state, closed } = run([{ type: 'startup', at: T0 + 600_000 }], mkDeps(), dirty);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.end).toBe(T0 + 90_000);
    expect(closed[0]!.endReason).toBe('cap');
    expect(state.current).toBeNull();
  });

  it('E10 零长段：开段同刻关段，不写库', () => {
    const { closed } = run([
      act(1, 100, TW, T0),
      { type: 'idle-changed', state: 'idle', at: T0 },
    ]);
    expect(closed).toHaveLength(0);
  });

  it('E11 无段心跳：水位不动、无段产生', () => {
    const { state, closed } = run([hb(T0 + 5_000)]);
    expect(state.lastActiveAt).toBe(0);
    expect(closed).toHaveLength(0);
    expect(state.current).toBeNull();
  });

  it('E12 跨 dayCutoff：一段拆两条，date 各归其日（不变量 3）', () => {
    const nextDay = (h: number, m = 0) => new Date(2026, 8, 7, h, m, 0, 0).getTime();
    const events: TrackerEvent[] = [act(1, 100, TW, localTs(23, 58))];
    for (let i = 1; i <= 9; i++) events.push(hb(localTs(23, 58) + i * 30_000));
    events.push({ type: 'idle-changed', state: 'idle', at: nextDay(0, 3) });
    const { closed } = run(events);
    expect(closed).toHaveLength(2);
    expect(closed[0]).toMatchObject({ date: '2026-09-06', end: nextDay(0) });
    expect(closed[1]).toMatchObject({ date: '2026-09-07', start: nextDay(0), end: nextDay(0, 3) });
  });

  it('E13 跨窗口切换：旧窗口段 blur 关闭，新窗口 active tab 开段', () => {
    const { state, closed } = run([act(1, 100, TW, T0), act(2, 200, GH, T0 + 45_000)]);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.endReason).toBe('blur');
    expect(state.current).toMatchObject({ windowId: 200, tabId: 2 });
  });

  it('E14 sync 冷启动对账：聚焦窗口的 active tab 立即开段', () => {
    const { state } = run([
      {
        type: 'sync',
        at: T0,
        focusedWindowId: 100,
        idleState: 'active',
        tabs: [
          { windowId: 100, tabId: 1, url: TW, incognito: false },
          { windowId: 200, tabId: 2, url: GH, incognito: false },
        ],
      },
    ]);
    expect(state.current).toMatchObject({ windowId: 100, tabId: 1, categoryId: 'entertainment' });
    expect(state.activeTabs[200]).toMatchObject({ tabId: 2 });
  });

  it('E15 chrome:// 等不可追踪 URL 不产生段，但记账正常', () => {
    const { state, closed } = run([act(1, 100, 'chrome://newtab', T0)]);
    expect(closed).toHaveLength(0);
    expect(state.current).toBeNull();
    expect(state.focusedWindowId).toBe(100);
  });

  it('E16 隐身标签页照常计时并带 incognito 标记（PRODUCT.md §3.7）', () => {
    const { state } = run([act(1, 100, TW, T0, true)]);
    expect(state.current).toMatchObject({ incognito: true, categoryId: 'entertainment' });
  });

  it('状态不可变：step 不修改传入的 prev', () => {
    const prev = initialState();
    const before = JSON.stringify(prev);
    step(prev, act(1, 100, TW, T0), mkDeps());
    expect(JSON.stringify(prev)).toBe(before);
  });
});
