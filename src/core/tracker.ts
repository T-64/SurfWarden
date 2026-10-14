import { splitByDay } from '../shared/datetime';
import { hostOf, isTrackable } from './classify';
import type {
  ActiveSegment,
  ClassifyResult,
  PageInfo,
  Piece,
  StepResult,
  TabInfo,
  TrackerDeps,
  TrackerEvent,
  TrackerState,
} from './types';

/**
 * 计时状态机（纯函数，ADR-0014 对账模型）。
 *
 * 每个事件只做两件事：① 记账（簿记 + 活动水位）；② 对账——算出"此刻应计时的目标"，
 * 与当前段比较，不同就关段、需要就开段。
 *
 * 时间铁律：关段 end = min(事件时刻, 水位 + 宽限)；因系统 idle 关段再回溯一个阈值。
 * 水位 = 最后一次有正证据的活动时刻；SW 被杀 / 系统休眠的空窗永远不计入。
 */

/** 心跳调度抖动容忍：正常 30s 间隔，宽限 60s，叠加抖动不误判 */
const HB_JITTER_MS = 15_000;

export function initialState(): TrackerState {
  return {
    focusedWindowId: null,
    activeTabs: {},
    pages: {},
    override: null,
    idleState: 'active',
    lastActiveAt: 0,
    current: null,
  };
}

export function step(prev: TrackerState, ev: TrackerEvent, deps: TrackerDeps): StepResult {
  const s = structuredClone(prev);
  const pieces: Piece[] = [];
  const graceMs = deps.idleGraceSec * 1000;
  let idleClose = false;

  // ① 记账
  switch (ev.type) {
    case 'tab-activated':
      s.focusedWindowId = ev.windowId;
      s.activeTabs[ev.windowId] = tabInfo(ev);
      touch(s, ev.at);
      break;
    case 'tab-updated':
      s.activeTabs[ev.windowId] = tabInfo(ev);
      if (ev.windowId === s.focusedWindowId) touch(s, ev.at);
      break;
    case 'tab-removed':
      for (const [wid, t] of Object.entries(s.activeTabs)) {
        if (t.tabId === ev.tabId) delete s.activeTabs[Number(wid)];
      }
      delete s.pages[ev.tabId];
      if (s.override?.tabId === ev.tabId) s.override = null;
      break;
    case 'window-focus':
      s.focusedWindowId = ev.windowId === -1 ? null : ev.windowId;
      if (ev.windowId !== -1) touch(s, ev.at);
      break;
    case 'idle-changed':
      s.idleState = ev.state;
      if (ev.state === 'active') touch(s, ev.at);
      idleClose = ev.state === 'idle';
      break;
    case 'page': {
      s.pages[ev.tabId] = ev.page;
      const focused = s.focusedWindowId === null ? undefined : s.activeTabs[s.focusedWindowId];
      if (focused?.tabId === ev.tabId) touch(s, ev.at);
      break;
    }
    case 'override':
      s.override = ev.override;
      break;
    case 'heartbeat':
      if (s.current) {
        if (ev.at - s.lastActiveAt > graceMs + HB_JITTER_MS) {
          // 证据断裂（SW 被杀 / 系统休眠）：按水位截断，下方对账会重开
          pieces.push(...closeCurrent(s, ev.at, false, deps));
        } else {
          touch(s, ev.at);
          pieces.push(...flush(s, ev.at, deps));
        }
      }
      break;
    case 'reclassify':
      break;
    case 'sync':
      s.focusedWindowId = ev.focusedWindowId;
      s.idleState = ev.idleState;
      s.activeTabs = {};
      for (const t of ev.tabs) s.activeTabs[t.windowId] = tabInfo(t);
      touch(s, ev.at);
      break;
  }

  // ② 对账
  const want = desiredTab(s);
  const cls = want ? classifyTab(s, want, deps) : null;
  const cur = s.current;
  if (cur) {
    const same =
      want !== null &&
      cls !== null &&
      want.tabId === cur.tabId &&
      s.focusedWindowId === cur.windowId &&
      want.url === cur.url &&
      cls.category === cur.category;
    if (same) {
      cur.title = want.title;
      cur.source = cls.source;
      cur.channel = pageOf(s, want)?.channel;
    } else {
      pieces.push(...closeCurrent(s, ev.at, idleClose, deps));
    }
  }
  if (!s.current && want && cls) open(s, want, cls, ev.at);

  return { state: s, pieces };
}

/** 此刻应计时的标签页：聚焦窗口的 active tab，且 (系统活跃 ∨ 有媒体证据) ∧ 未锁屏 */
export function desiredTab(s: TrackerState): TabInfo | null {
  if (s.focusedWindowId === null) return null;
  const tab = s.activeTabs[s.focusedWindowId];
  if (!tab || !isTrackable(tab.url)) return null;
  if (s.idleState === 'locked') return null;
  if (s.idleState === 'idle' && !(tab.audible === true || pageOf(s, tab)?.mediaPlaying === true)) return null;
  return tab;
}

function pageOf(s: TrackerState, tab: TabInfo): PageInfo | undefined {
  const p = s.pages[tab.tabId];
  return p && p.url === tab.url ? p : undefined;
}

function classifyTab(s: TrackerState, tab: TabInfo, deps: TrackerDeps): ClassifyResult | null {
  const o = s.override;
  if (o && o.tabId === tab.tabId && o.url === tab.url) return { category: o.category, source: 'manual' };
  return deps.classify(tab.url, pageOf(s, tab)?.channel);
}

function tabInfo(t: TabInfo): TabInfo {
  return { tabId: t.tabId, url: t.url, title: t.title, incognito: t.incognito, audible: t.audible };
}

function touch(s: TrackerState, at: number): void {
  if (at > s.lastActiveAt) s.lastActiveAt = at;
}

function open(s: TrackerState, tab: TabInfo, cls: ClassifyResult, at: number): void {
  const host = hostOf(tab.url);
  if (!host || s.focusedWindowId === null) return;
  s.current = {
    id: `${tab.tabId}-${at}`,
    windowId: s.focusedWindowId,
    tabId: tab.tabId,
    url: tab.url,
    host,
    title: tab.title,
    incognito: tab.incognito,
    category: cls.category,
    source: cls.source,
    channel: pageOf(s, tab)?.channel,
    startedAt: at,
    pieceStart: at,
  };
  touch(s, at);
}

function toPieces(cur: ActiveSegment, end: number, deps: TrackerDeps): Piece[] {
  if (end <= cur.pieceStart) return [];
  return splitByDay(cur.pieceStart, end, deps.dayCutoffHour).map((p) => ({
    segId: cur.id,
    date: p.date,
    start: p.start,
    end: p.end,
    host: cur.host,
    url: cur.url,
    title: cur.title,
    category: cur.category,
    source: cur.source,
    channel: cur.channel,
    incognito: cur.incognito,
  }));
}

/**
 * 心跳落库：只落到 at − idle 阈值。idle 事件滞后一个阈值才到，届时会回溯关段；
 * 已落库的部分无法撤回，所以落库线必须停在回溯点之前。实时读数由调用方补上
 * liveSeconds()。
 */
function flush(s: TrackerState, at: number, deps: TrackerDeps): Piece[] {
  const cur = s.current;
  if (!cur) return [];
  const upTo = at - deps.idleThresholdSec * 1000;
  if (upTo <= cur.pieceStart) return [];
  const out = toPieces(cur, upTo, deps);
  cur.pieceStart = upTo;
  return out;
}

/** 当前段尚未落库的秒数（实时读数 = 库 + 此值） */
export function liveSeconds(s: TrackerState, now: number): number {
  return s.current ? Math.max(0, Math.round((now - s.current.pieceStart) / 1000)) : 0;
}

function closeCurrent(s: TrackerState, at: number, idle: boolean, deps: TrackerDeps): Piece[] {
  const cur = s.current;
  s.current = null;
  if (!cur) return [];
  let end = Math.min(at, s.lastActiveAt + deps.idleGraceSec * 1000);
  if (idle) end = Math.min(end, at - deps.idleThresholdSec * 1000);
  return toPieces(cur, Math.max(end, cur.pieceStart), deps);
}
