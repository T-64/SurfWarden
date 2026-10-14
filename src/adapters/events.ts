import type { IdleState, TabInfo, TrackerEvent } from '../core/types';

/**
 * chrome.* 原始事件 → TrackerEvent。只做补全与转发，不含计时语义（ADR-0014）。
 * 隐身窗口事件只有用户授权后才会到达；tabs.get 失败（标签已关）静默丢弃。
 */

function info(t: chrome.tabs.Tab): TabInfo | null {
  if (t.id == null || t.url == null) return null;
  return { tabId: t.id, url: t.url, title: t.title, incognito: t.incognito, audible: t.audible };
}

export function wireEvents(emit: (ev: TrackerEvent) => void): void {
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    chrome.tabs
      .get(tabId)
      .then((t) => {
        const i = info(t);
        if (i) emit({ type: 'tab-activated', windowId, at: Date.now(), ...i });
      })
      .catch(() => undefined);
  });

  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.url === undefined && change.title === undefined && change.audible === undefined) return;
    if (!tab.active || tab.windowId == null) return; // 只关心各窗口的 active tab
    const i = info(tab);
    if (i) emit({ type: 'tab-updated', windowId: tab.windowId, at: Date.now(), ...i });
  });

  chrome.tabs.onRemoved.addListener((tabId) => emit({ type: 'tab-removed', tabId, at: Date.now() }));

  chrome.windows.onFocusChanged.addListener((windowId) => emit({ type: 'window-focus', windowId, at: Date.now() }));

  chrome.idle.onStateChanged.addListener((state) => emit({ type: 'idle-changed', state: state as IdleState, at: Date.now() }));
}

/** 冷启动 / 配置变化后全量对账：各窗口 active tab + 聚焦窗口 + idle 状态 */
export async function buildSyncEvent(idleThresholdSec: number): Promise<TrackerEvent> {
  const [tabs, focusedWindowId, idleState] = await Promise.all([
    chrome.tabs.query({ active: true }),
    chrome.windows
      .getLastFocused()
      .then((w) => (w.focused ? (w.id ?? null) : null))
      .catch(() => null),
    chrome.idle.queryState(idleThresholdSec),
  ]);
  return {
    type: 'sync',
    at: Date.now(),
    focusedWindowId,
    idleState: idleState as IdleState,
    tabs: tabs.flatMap((t) => {
      const i = info(t);
      return i && t.windowId != null ? [{ windowId: t.windowId, ...i }] : [];
    }),
  };
}
