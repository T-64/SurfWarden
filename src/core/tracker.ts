import { splitByDay } from '../shared/datetime';
import type {
  ActiveSegment,
  ClosedSegment,
  EndReason,
  StepResult,
  TabInfo,
  TrackerDeps,
  TrackerEvent,
  TrackerState,
} from './types';

/**
 * 计时状态机（纯函数）——语义见 docs/design/key-algorithms.md §1 与 ADR-0003。
 *
 * 时间语义两条铁律：
 * 1. 关段时 end = min(事件时刻, 水位 + 宽限)——水位是"用户活跃的最后正证据"，
 *    SW 被杀/系统休眠留下的空窗不允许被计入。
 * 2. 心跳只在"当前在计时且距水位足够近"时前移水位；跳档心跳（休眠醒来）
 *    视为证据断裂：先按水位截断关段，再重开新段（误差 ≤ idle 阈值 + 宽限）。
 */

/** 心跳允许的调度抖动：正常间隔 30s，宽限 60–90s，叠加抖动后不会误判 */
const HB_JITTER_MS = 15_000;

export function initialState(): TrackerState {
  return { focusedWindowId: null, activeTabs: {}, current: null, lastActiveAt: 0 };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function cloneState(s: TrackerState): TrackerState {
  return {
    focusedWindowId: s.focusedWindowId,
    activeTabs: Object.fromEntries(
      Object.entries(s.activeTabs).map(([k, v]) => [k as unknown as number, { ...v }]),
    ),
    current: s.current ? { ...s.current } : null,
    lastActiveAt: s.lastActiveAt,
  };
}

function touch(s: TrackerState, at: number): void {
  if (at > s.lastActiveAt) s.lastActiveAt = at;
}

function closeSegment(
  s: TrackerState,
  at: number,
  reason: EndReason,
  deps: TrackerDeps,
): ClosedSegment[] {
  const cur: ActiveSegment | null = s.current;
  s.current = null;
  if (!cur) return [];
  const graceEnd = s.lastActiveAt + deps.idleGraceSec * 1000;
  const end = Math.min(Math.max(at, cur.startedAt), Math.max(graceEnd, cur.startedAt));
  if (end <= cur.startedAt) return [];
  const truncated = end < at;
  return splitByDay(cur.startedAt, end, deps.dayCutoffHour).map((p) => ({
    date: p.date,
    start: p.start,
    end: p.end,
    host: cur.host,
    url: cur.url,
    title: cur.title,
    categoryId: cur.categoryId,
    ruleId: cur.ruleId,
    incognito: cur.incognito,
    endReason: truncated ? 'cap' : reason,
  }));
}

function tryOpen(s: TrackerState, at: number, deps: TrackerDeps): void {
  if (s.focusedWindowId === null) return;
  const tab: TabInfo | undefined = s.activeTabs[s.focusedWindowId];
  if (!tab) return;
  const host = hostOf(tab.url);
  if (!host) return;
  const cls = deps.classify(tab.url);
  if (!cls) return;
  s.current = {
    windowId: s.focusedWindowId,
    tabId: tab.tabId,
    url: tab.url,
    host,
    title: tab.title,
    incognito: tab.incognito,
    categoryId: cls.categoryId,
    ruleId: cls.ruleId,
    startedAt: at,
  };
  touch(s, at);
}

/** 状态机唯一入口 */
export function step(prev: TrackerState, ev: TrackerEvent, deps: TrackerDeps): StepResult {
  const s = cloneState(prev);
  const closed: ClosedSegment[] = [];
  const graceMs = deps.idleGraceSec * 1000;

  // 1. 记账：窗口/标签簿记 + 活动水位
  switch (ev.type) {
    case 'tab-activated': {
      s.focusedWindowId = ev.windowId;
      s.activeTabs[ev.windowId] = {
        tabId: ev.tabId,
        url: ev.url,
        title: ev.title,
        incognito: ev.incognito,
      };
      touch(s, ev.at);
      break;
    }
    case 'tab-updated': {
      const t = s.activeTabs[ev.windowId];
      if (t && t.tabId === ev.tabId) {
        t.url = ev.url;
        t.title = ev.title;
        t.incognito = ev.incognito;
      }
      if (ev.windowId === s.focusedWindowId) touch(s, ev.at);
      break;
    }
    case 'tab-removed': {
      for (const [wid, t] of Object.entries(s.activeTabs)) {
        if (t.tabId === ev.tabId) delete s.activeTabs[Number(wid)];
      }
      if (s.current?.tabId === ev.tabId) touch(s, ev.at);
      break;
    }
    case 'window-focus': {
      s.focusedWindowId = ev.windowId === -1 ? null : ev.windowId;
      if (ev.windowId !== -1) touch(s, ev.at);
      break;
    }
    case 'idle-changed': {
      if (ev.state === 'active') touch(s, ev.at);
      break;
    }
    case 'heartbeat': {
      // 仅当在计时且证据链连续时前移水位；跳档心跳走下面第 2 步的 cap 关段
      if (s.current && ev.at - s.lastActiveAt <= graceMs + HB_JITTER_MS) touch(s, ev.at);
      break;
    }
    case 'sync': {
      s.focusedWindowId = ev.focusedWindowId;
      s.activeTabs = {};
      for (const t of ev.tabs) {
        s.activeTabs[t.windowId] = {
          tabId: t.tabId,
          url: t.url,
          title: t.title,
          incognito: t.incognito,
        };
      }
      touch(s, ev.at);
      break;
    }
    case 'startup':
      break;
  }

  // 2. 判定当前段是否应结束
  const cur = s.current;
  let closeReason: EndReason | null = null;
  if (cur) {
    if (ev.type === 'idle-changed' && ev.state !== 'active') closeReason = 'idle';
    else if (ev.type === 'window-focus' && ev.windowId !== cur.windowId) closeReason = 'blur';
    else if (ev.type === 'tab-activated' && ev.windowId !== cur.windowId) closeReason = 'blur';
    else if (ev.type === 'tab-activated' && ev.tabId !== cur.tabId) closeReason = 'event';
    else if (
      ev.type === 'tab-updated' &&
      ev.windowId === cur.windowId &&
      ev.tabId === cur.tabId &&
      ev.url !== cur.url
    )
      closeReason = 'event';
    else if (ev.type === 'tab-removed' && ev.tabId === cur.tabId) closeReason = 'event';
    else if (ev.type === 'startup') closeReason = 'cap';
    else if (ev.type === 'heartbeat' && ev.at - prev.lastActiveAt > graceMs + HB_JITTER_MS)
      closeReason = 'cap';
  }
  if (closeReason && cur) closed.push(...closeSegment(s, ev.at, closeReason, deps));

  // 3. 判定是否开新段
  if (!s.current) {
    let open = false;
    if (ev.type === 'tab-activated' || ev.type === 'sync') open = true;
    else if (ev.type === 'window-focus' && ev.windowId !== -1) open = true;
    else if (ev.type === 'idle-changed' && ev.state === 'active') open = true;
    else if (closed.length > 0 && (ev.type === 'tab-updated' || ev.type === 'heartbeat'))
      open = true; // URL 变化换段 / 心跳 cap 后重开
    if (open) tryOpen(s, ev.at, deps);
  }

  return { state: s, closed };
}
