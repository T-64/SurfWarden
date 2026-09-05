import type { IdleState, TrackerEvent } from '../core/types';

/**
 * chrome.* 原始事件 → 归一化 TrackerEvent。
 * 职责边界（dev-process §2）：这里只做事件补全与转发，不含任何计时语义。
 *
 * 注意：
 * - 隐身窗口事件只有用户授权后才会到达（PRODUCT.md §3.7）；未授权时缺口由
 *   v0.3 的检测引导覆盖，这里无需特殊处理。
 * - tabs.get 失败（tab 已关闭）静默丢弃，状态由 onRemoved/onActivated 收敛。
 */

export const HEARTBEAT_ALARM = 'sw-heartbeat';

export function wireEvents(emit: (ev: TrackerEvent) => void): void {
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    chrome.tabs
      .get(tabId)
      .then((t) => {
        if (t.windowId == null || t.url == null) return;
        emit({
          type: 'tab-activated',
          windowId: t.windowId,
          tabId,
          url: t.url,
          title: t.title,
          incognito: t.incognito,
          at: Date.now(),
        });
      })
      .catch(() => undefined);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && !changeInfo.title) return;
    if (tab.windowId == null || tab.url == null) return;
    if (!tab.active) return; // v0.1 只追踪各窗口 active tab，后台 tab 的标题变化不产生事件
    emit({
      type: 'tab-updated',
      windowId: tab.windowId,
      tabId,
      url: tab.url,
      title: tab.title,
      incognito: tab.incognito,
      at: Date.now(),
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    emit({ type: 'tab-removed', tabId, at: Date.now() });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    emit({ type: 'window-focus', windowId, at: Date.now() });
  });

  chrome.idle.onStateChanged.addListener((s) => {
    emit({ type: 'idle-changed', state: s as IdleState, at: Date.now() });
  });

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === HEARTBEAT_ALARM) emit({ type: 'heartbeat', at: Date.now() });
  });
}

/** SW 冷启动全量对账：各窗口 active tab + 聚焦窗口 + 系统 idle 状态 */
export async function buildSyncEvent(idleThresholdSec: number): Promise<TrackerEvent> {
  const [tabs, focusedWindowId, idleState] = await Promise.all([
    chrome.tabs.query({ active: true }),
    chrome.windows
      .getLastFocused()
      .then((w) => w.id ?? null)
      .catch(() => null),
    chrome.idle.queryState(idleThresholdSec),
  ]);
  return {
    type: 'sync',
    at: Date.now(),
    focusedWindowId,
    idleState: idleState as IdleState,
    tabs: tabs.flatMap((t) =>
      t.windowId == null || t.id == null || t.url == null
        ? []
        : [
            {
              windowId: t.windowId,
              tabId: t.id,
              url: t.url,
              title: t.title,
              incognito: t.incognito,
            },
          ],
    ),
  };
}
