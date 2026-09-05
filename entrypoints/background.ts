import { buildSyncEvent, HEARTBEAT_ALARM, wireEvents } from '../src/adapters/chromeEvents';
import { configStore } from '../src/adapters/configStore';
import {
  addExempt,
  exemptCountForDate,
  recordSegments,
  todayKey,
  usageForDate,
} from '../src/adapters/db';
import { applyBlockRules, domainsByCategory, planBlockRules } from '../src/adapters/dnr';
import { budgetState, supervise, usageByCategory } from '../src/core/budget';
import { initialState, step } from '../src/core/tracker';
import type {
  Category,
  ClassifyResult,
  TrackerDeps,
  TrackerEvent,
  TrackerState,
} from '../src/core/types';
import { compileRules, matchUrlOrDefault } from '../src/core/urlMatch';
import { nextDayBoundary } from '../src/shared/datetime';

/**
 * SW 大脑：计时（ADR-0003/0006）+ 预算检查点 + 封锁（ADR-0004/0008）+ 消息协议。
 * 业务判定全部在 core（budget/tracker/urlMatch），这里只做执行与 IO。
 */

const SNAPSHOT_KEY = 'tracker';
const EXEMPT_KEY = 'exempted'; // { [catId]: 豁免截止时间戳 }，session 级
const DAYCUT_ALARM = 'sw-daycut';
const EXEMPT_END_ALARM = 'sw-exempt-end';

interface CurrentInfo {
  url: string;
  host: string;
  categoryId: string;
  startedAt: number;
  incognito: boolean;
}

export default defineBackground(() => {
  let state: TrackerState = initialState();
  let deps: TrackerDeps | null = null;
  const lastBannerState = new Map<string, string>(); // catId → 上次横幅状态（transition 去重）

  // ---------- 配置与对账 ----------

  async function refreshDeps(): Promise<void> {
    const [rules, settings] = await Promise.all([configStore.getRules(), configStore.getSettings()]);
    const compiled = compileRules(rules);
    chrome.idle.setDetectionInterval(settings.idleThresholdSec);
    deps = {
      idleGraceSec: settings.idleGraceSec,
      dayCutoffHour: settings.dayCutoffHour,
      classify: (url): ClassifyResult | null => matchUrlOrDefault(compiled, url, 'neutral'),
    };
  }

  async function refreshAndSync(): Promise<void> {
    await refreshDeps();
    const settings = await configStore.getSettings();
    await handle(await buildSyncEvent(settings.idleThresholdSec));
    await budgetCheckpoint();
    scheduleDaycut(settings.dayCutoffHour);
  }

  // ---------- 计时事件流 ----------

  async function handle(ev: TrackerEvent): Promise<void> {
    if (!deps) return;
    const r = step(state, ev, deps);
    state = r.state;
    if (r.closed.length > 0) {
      await recordSegments(r.closed);
      await budgetCheckpoint();
    }
    await chrome.storage.session.set({ [SNAPSHOT_KEY]: state });
    void updateBadge();
  }

  // ---------- 预算检查点与封锁 ----------

  async function budgetCheckpoint(): Promise<void> {
    if (!deps) return;
    const [rules, categories, settings] = await Promise.all([
      configStore.getRules(),
      configStore.getCategories(),
      configStore.getSettings(),
    ]);
    const date = todayKey(settings.dayCutoffHour);
    const [rows, exemptUsed] = await Promise.all([
      usageForDate(date),
      exemptCountForDate(date),
    ]);
    const used = usageByCategory(rows);
    const domainMap = domainsByCategory(rules);
    const exempted = await getExempted();

    const now = Date.now();
    const blocked = new Map<string, Set<string>>();
    for (const cat of categories) {
      const st = budgetState(used.get(cat.id) ?? 0, cat.budgetMin);
      const d = supervise(cat, st, settings.pauseUntil, now);
      const stillExempt = (exempted[cat.id] ?? 0) > now;
      if (d.block && !stillExempt) {
        const domains = domainMap.get(cat.id);
        if (domains && domains.size > 0) blocked.set(cat.id, domains);
      }
      // 横幅：状态跃迁时发一次（exhausted 期间每 30 分钟重提醒一次）
      if (d.banner && cat.action !== 'track') {
        const prev = lastBannerState.get(cat.id);
        if (prev !== st) {
          lastBannerState.set(cat.id, st);
          void sendNudge(cat, used.get(cat.id) ?? 0, cat.budgetMin);
        }
      } else if (!d.banner) {
        lastBannerState.delete(cat.id);
      }
    }
    void exemptUsed; // 豁免资格在 guide 页豁免动作时校验，这里不使用

    await applyBlockRules(
      planBlockRules(blocked, {
        guideUrl: (catId, domain) =>
          `${chrome.runtime.getURL('guide.html')}?cat=${encodeURIComponent(catId)}&url=${encodeURIComponent(
            `https://${domain}/`,
          )}`,
      }),
    );
  }

  async function getExempted(): Promise<Record<string, number>> {
    const o = await chrome.storage.session.get(EXEMPT_KEY);
    return (o[EXEMPT_KEY] as Record<string, number> | undefined) ?? {};
  }

  async function setExempted(map: Record<string, number>): Promise<void> {
    await chrome.storage.session.set({ [EXEMPT_KEY]: map });
  }

  // ---------- 徽章 ----------

  async function updateBadge(): Promise<void> {
    const cur = state.current;
    if (!cur) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const [cats, settings] = await Promise.all([configStore.getCategories(), configStore.getSettings()]);
    const cat = cats.find((c) => c.id === cur.categoryId);
    const rows = await usageForDate(todayKey(settings.dayCutoffHour));
    const used = usageByCategory(rows).get(cur.categoryId) ?? 0;
    if (cat?.budgetMin !== undefined) {
      const remainMin = Math.max(0, Math.ceil((cat.budgetMin * 60 - used) / 60));
      await chrome.action.setBadgeText({ text: String(remainMin) });
      await chrome.action.setBadgeBackgroundColor({ color: remainMin === 0 ? '#dc2626' : '#16a34a' });
    } else {
      await chrome.action.setBadgeText({ text: String(Math.floor(used / 60)) });
      await chrome.action.setBadgeBackgroundColor({ color: cat?.color ?? '#6b7280' });
    }
  }

  // ---------- 横幅通知 ----------

  async function sendNudge(cat: Category, usedSec: number, budgetMin?: number): Promise<void> {
    const cur = state.current;
    if (!cur) return;
    const remain = budgetMin !== undefined ? Math.max(0, budgetMin - Math.floor(usedSec / 60)) : 0;
    const text =
      budgetMin !== undefined
        ? `「${cat.name}」今日剩约 ${remain} 分钟（已用 ${Math.floor(usedSec / 60)} 分钟）`
        : `「${cat.name}」已连续使用较久，注意休息`;
    try {
      await chrome.tabs.sendMessage(cur.tabId, { type: 'sw-nudge', text });
    } catch {
      // 该 tab 无 content script（扩展页/商店页等），忽略
    }
  }

  // ---------- 消息协议（popup / guide） ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    void (async () => {
      if (msg?.type === 'sw-get-state') {
        const cur = state.current;
        const info: CurrentInfo | null = cur
          ? {
              url: cur.url,
              host: cur.host,
              categoryId: cur.categoryId,
              startedAt: cur.startedAt,
              incognito: cur.incognito,
            }
          : null;
        sendResponse({ current: info });
        return;
      }
      if (msg?.type === 'sw-reclassify') {
        // 一键改判：改当前开着的段（close 时按新类别入库）
        if (state.current && typeof msg.categoryId === 'string') {
          state.current.categoryId = msg.categoryId;
          state.current.ruleId = 'manual';
          await chrome.storage.session.set({ [SNAPSHOT_KEY]: state });
          void updateBadge();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, reason: 'no-active-segment' });
        }
        return;
      }
      if (msg?.type === 'sw-exempt') {
        const catId = String(msg.categoryId ?? '');
        const settings = await configStore.getSettings();
        const date = todayKey(settings.dayCutoffHour);
        const used = await exemptCountForDate(date);
        if (used >= settings.exemptPerDay) {
          sendResponse({ ok: false, reason: 'exempt-exhausted' });
          return;
        }
        const exempted = await getExempted();
        exempted[catId] = Date.now() + settings.exemptMinutes * 60_000;
        await setExempted(exempted);
        await addExempt(date);
        await budgetCheckpoint();
        chrome.alarms.create(`${EXEMPT_END_ALARM}:${catId}`, {
          when: exempted[catId],
        });
        sendResponse({ ok: true, remaining: settings.exemptPerDay - used - 1 });
        return;
      }
      sendResponse({ ok: false, reason: 'unknown-message' });
    })();
    return true; // 异步 sendResponse
  });

  // ---------- 闹钟 ----------

  function scheduleDaycut(cutoffHour: number): void {
    chrome.alarms.create(DAYCUT_ALARM, { when: nextDayBoundary(Date.now(), cutoffHour) });
  }

  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === HEARTBEAT_ALARM) {
      void handle({ type: 'heartbeat', at: Date.now() });
      return;
    }
    if (a.name === DAYCUT_ALARM) {
      void (async () => {
        await budgetCheckpoint();
        scheduleDaycut((await configStore.getSettings()).dayCutoffHour);
      })();
      return;
    }
    if (a.name.startsWith(`${EXEMPT_END_ALARM}:`)) {
      void (async () => {
        const catId = a.name.slice(EXEMPT_END_ALARM.length + 1);
        const exempted = await getExempted();
        delete exempted[catId];
        await setExempted(exempted);
        await budgetCheckpoint();
      })();
    }
  });

  // ---------- 启动 ----------

  void (async () => {
    await configStore.ensureDefaults();

    const stored = await chrome.storage.session.get(SNAPSHOT_KEY);
    const snap = stored[SNAPSHOT_KEY] as TrackerState | undefined;
    if (snap) {
      // SW 重启：段与记账从快照继续，不做 sync（避免覆盖进行中的状态）
      state = snap;
      await refreshDeps();
      await budgetCheckpoint();
    } else {
      // 浏览器级冷启动：无残留，按当前环境全量对账
      await refreshAndSync();
    }
    configStore.onLocalChange(() => void refreshAndSync());

    wireEvents((ev) => void handle(ev));
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  })();
});
