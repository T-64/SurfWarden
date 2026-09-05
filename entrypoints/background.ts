import { buildSyncEvent, HEARTBEAT_ALARM, wireEvents } from '../src/adapters/chromeEvents';
import { configStore } from '../src/adapters/configStore';
import { recordSegments } from '../src/adapters/db';
import { initialState, step } from '../src/core/tracker';
import type { TrackerDeps, TrackerEvent, TrackerState } from '../src/core/types';
import { compileRules, matchUrlOrDefault } from '../src/core/urlMatch';

/**
 * SW 大脑：事件 → core.tracker 状态机 → 持久化。
 * 职责（architecture.md §3）：唯一权威的计时状态；扩展页面只读存储。
 *
 * 生命周期要点（ADR-0003）：
 * - 状态快照存 chrome.storage.session：SW 重启间保留，浏览器重启自动清空。
 * - 冷启动：有快照直接恢复（段继续跑）；无快照说明浏览器刚启动，无残留段。
 * - 每次状态变化都写快照；心跳 30s 兜底推进水位。
 */

const SNAPSHOT_KEY = 'tracker';

export default defineBackground(() => {
  let state: TrackerState = initialState();
  let deps: TrackerDeps | null = null;

  /** 只刷新规则/idle 配置（不动状态机的记账） */
  async function refreshDeps(): Promise<void> {
    const [rules, settings] = await Promise.all([configStore.getRules(), configStore.getSettings()]);
    const compiled = compileRules(rules);
    chrome.idle.setDetectionInterval(settings.idleThresholdSec);
    deps = {
      idleGraceSec: settings.idleGraceSec,
      dayCutoffHour: settings.dayCutoffHour,
      // 无规则命中 → 默认类别 neutral；非 http(s) → null（不可追踪）
      classify: (url) => matchUrlOrDefault(compiled, url, 'neutral'),
    };
  }

  /** 刷新配置 + 全量对账（SW 冷启动无快照 / 配置变更时） */
  async function refreshAndSync(): Promise<void> {
    await refreshDeps();
    const settings = await configStore.getSettings();
    await handle(await buildSyncEvent(settings.idleThresholdSec));
  }

  async function handle(ev: TrackerEvent): Promise<void> {
    if (!deps) return;
    const r = step(state, ev, deps);
    state = r.state;
    if (r.closed.length > 0) await recordSegments(r.closed);
    await chrome.storage.session.set({ [SNAPSHOT_KEY]: state });
  }

  void (async () => {
    await configStore.ensureDefaults();

    const stored = await chrome.storage.session.get(SNAPSHOT_KEY);
    const snap = stored[SNAPSHOT_KEY] as TrackerState | undefined;
    if (snap) {
      // SW 重启：段与记账从快照继续，不做 sync（避免覆盖进行中的状态）
      state = snap;
      await refreshDeps();
    } else {
      // 浏览器级冷启动：无残留，按当前环境全量对账
      await refreshAndSync();
    }
    configStore.onLocalChange(() => void refreshAndSync());

    wireEvents((ev) => void handle(ev));
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  })();
});
