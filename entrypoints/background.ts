import { buildSyncEvent, wireEvents } from '../src/adapters/events';
import { config } from '../src/adapters/config';
import { addEvent, countEvents, purgeSessionsOlderThan, recordPieces, usageFor } from '../src/adapters/db';
import { channelKey, hostOf, makeClassifier, siteKey, type Classifier } from '../src/core/classify';
import { totalsByCategory, type CategoryTotals } from '../src/core/metrics';
import { checkCurfewExt, checkGrant, checkPrivateGrant, decide, type PolicyInput } from '../src/core/policy';
import { formatHHMM, lastOccurrence, nextOccurrence, nextPhaseChange, phaseAt } from '../src/core/schedule';
import { initialState, liveSeconds, step } from '../src/core/tracker';
import type { CategoryId, ClassifyResult, Pass, Settings, TrackerDeps, TrackerEvent, TrackerState } from '../src/core/types';
import { parsePattern } from '../src/core/urlMatch';
import { addDays, dateKey, nextDayBoundary } from '../src/shared/datetime';
import { DEFAULT_SETTINGS } from '../src/shared/defaults';
import type { ActionResult, ContinueGerman, GateContext, Msg, PopupState, VerdictResponse } from '../src/shared/messages';

/**
 * SW：判决与计时的唯一权威。业务判断全部在 core（tracker / classify / policy），这里只做 IO。
 * 所有入口（chrome 事件、消息、闹钟）经 serial() 串行，避免 await 间隙里的状态竞争。
 */

const S = { tracker: 'tracker', passes: 'passes', ext: 'curfewExt', gates: 'gateShown' } as const;
const A = { heartbeat: 'hb', phase: 'phase', daycut: 'daycut', passPrefix: 'pass:', extEnd: 'ext-end' } as const;
const GATE_SCRIPT = 'content-scripts/gate.js';

type GateShown = Record<number, { site: string; at: number }>;

export default defineBackground(() => {
  let state: TrackerState = initialState();
  let settings: Settings = DEFAULT_SETTINGS;
  let classifier: Classifier = makeClassifier([], []);
  let deps: TrackerDeps = depsFrom(settings, classifier);

  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  }

  // ---------- 配置 ----------

  function depsFrom(s: Settings, c: Classifier): TrackerDeps {
    return { idleGraceSec: s.idleGraceSec, idleThresholdSec: s.idleThresholdSec, dayCutoffHour: s.dayCutoffHour, classify: c };
  }

  async function loadConfig(): Promise<void> {
    const [s, rules, channels] = await Promise.all([config.getSettings(), config.getRules(), config.getChannels()]);
    settings = s;
    classifier = makeClassifier(rules, channels);
    deps = depsFrom(s, classifier);
    chrome.idle.setDetectionInterval(Math.max(15, s.idleThresholdSec));
  }

  // ---------- 计时 ----------

  async function apply(ev: TrackerEvent): Promise<void> {
    const r = step(state, ev, deps);
    state = r.state;
    if (r.pieces.length > 0) {
      await recordPieces(r.pieces);
      const g = r.pieces.filter((p) => p.category === 'german').pop();
      if (g) await config.saveLastGerman({ url: g.url, title: g.title, at: g.end });
    }
    await chrome.storage.session.set({ [S.tracker]: state });
  }

  const today = (now = Date.now()) => dateKey(now, settings.dayCutoffHour);

  /** 今日各类别秒数 = 库 + 当前段未落库部分 */
  async function liveTotals(now: number): Promise<CategoryTotals> {
    const totals = totalsByCategory(await usageFor([today(now)]));
    if (state.current) totals[state.current.category] += liveSeconds(state, now);
    return totals;
  }

  // ---------- 判决 ----------

  async function session<T>(key: string, fallback: T): Promise<T> {
    const o = await chrome.storage.session.get(key);
    return (o[key] as T | undefined) ?? fallback;
  }

  function classifyTab(tabId: number, url: string): ClassifyResult | null {
    const o = state.override;
    if (o && o.tabId === tabId && o.url === url) return { category: o.category, source: 'manual' };
    const page = state.pages[tabId];
    return classifier(url, page && page.url === url ? page.channel : undefined);
  }

  async function policyInput(category: CategoryId, host: string, now: number): Promise<PolicyInput> {
    const date = today(now);
    const [passes, totals, passesToday, curfewExtUsed, ext, privateUsed] = await Promise.all([
      session<Record<string, Pass>>(S.passes, {}),
      liveTotals(now),
      countEvents([date], 'pass'),
      countEvents([addDays(date, -1), date], 'curfew-ext', lastOccurrence(now, settings.schedule.bedtime)),
      session<{ until: number } | null>(S.ext, null),
      countEvents([date], 'private-pass'),
    ]);
    return {
      now,
      settings,
      category,
      host,
      pass: passes[siteKey(host)],
      driftUsedSec: totals.drift,
      passesToday,
      curfewExtUntil: ext?.until,
      curfewExtUsed,
      privateUsed,
    };
  }

  async function continueGerman(): Promise<ContinueGerman | null> {
    const [last, targets] = await Promise.all([config.getLastGerman(), config.getTargets()]);
    if (last && Date.now() - last.at < 14 * 86_400_000) return { name: last.title || hostOf(last.url) || '上次的德语', url: last.url };
    const t = targets[0];
    return t ? { name: t.name, url: t.url } : null;
  }

  async function verdictFor(tabId: number, url: string): Promise<VerdictResponse> {
    const cls = classifyTab(tabId, url);
    const host = hostOf(url);
    if (!cls || !host) return { verdict: { kind: 'allow' }, ctx: null };
    const now = Date.now();
    const input = await policyInput(cls.category, host, now);
    const verdict = decide(input);
    const site = siteKey(host);
    if (verdict.kind === 'gate' || verdict.kind === 'cooldown') {
      const gates = await session<GateShown>(S.gates, {});
      if (gates[tabId]?.site !== site) {
        gates[tabId] = { site, at: now };
        await chrome.storage.session.set({ [S.gates]: gates });
      }
    }
    const page = state.pages[tabId];
    const totals = await liveTotals(now);
    const ctx: GateContext = {
      url,
      host,
      site,
      category: cls.category,
      source: cls.source,
      channel: page && page.url === url ? page.channel : undefined,
      phase: phaseAt(now, settings.schedule),
      now,
      driftUsedMin: Math.floor(totals.drift / 60),
      driftCapMin: settings.driftCapMin,
      germanTodayMin: Math.floor(totals.german / 60),
      germanGoalMin: settings.germanGoalMin,
      continueGerman: await continueGerman(),
      pass: input.pass ? { intent: input.pass.intent, minutes: input.pass.minutes, until: input.pass.until } : undefined,
      bedtime: formatHHMM(settings.schedule.bedtime),
      wake: formatHHMM(settings.schedule.wake),
      curfewExtMin: settings.curfewExtMin,
    };
    return { verdict, ctx };
  }

  // ---------- 动作 ----------

  async function grant(tabId: number, url: string, minutes: number, intent: string): Promise<ActionResult> {
    const cls = classifyTab(tabId, url);
    const host = hostOf(url);
    if (!cls || !host) return { ok: false, reason: 'untrackable' };
    const now = Date.now();
    const site = siteKey(host);
    const gates = await session<GateShown>(S.gates, {});
    const shown = gates[tabId]?.site === site ? gates[tabId]?.at : undefined;
    const input = await policyInput(cls.category, host, now);
    const isPrivate = cls.category === 'private';
    if (isPrivate) minutes = settings.privatePassMin; // 私密只有一档，客户端传的分钟数不作数
    const check = isPrivate ? checkPrivateGrant(input, shown) : checkGrant(input, minutes, intent, shown);
    if (!check.ok) return check;
    const pass: Pass = { site, intent: intent.trim(), minutes, grantedAt: now, until: now + minutes * 60_000 };
    const passes = await session<Record<string, Pass>>(S.passes, {});
    passes[site] = pass;
    delete gates[tabId];
    await chrome.storage.session.set({ [S.passes]: passes, [S.gates]: gates });
    // 私密事件不记站点（报告里不暴露域名）
    await addEvent(
      isPrivate
        ? { date: today(now), at: now, type: 'private-pass', intent: pass.intent, minutes }
        : { date: today(now), at: now, type: 'pass', site, intent: pass.intent, minutes },
    );
    chrome.alarms.create(`${A.passPrefix}${site}`, { when: pass.until });
    void broadcast();
    return { ok: true };
  }

  async function retry(url: string): Promise<ActionResult> {
    const host = hostOf(url);
    if (!host) return { ok: false, reason: 'untrackable' };
    const passes = await session<Record<string, Pass>>(S.passes, {});
    delete passes[siteKey(host)];
    await chrome.storage.session.set({ [S.passes]: passes });
    return { ok: true };
  }

  async function extendCurfew(tabId: number, url: string, reason: string): Promise<ActionResult> {
    const cls = classifyTab(tabId, url);
    const host = hostOf(url);
    if (!cls || !host) return { ok: false, reason: 'untrackable' };
    const now = Date.now();
    const check = checkCurfewExt(await policyInput(cls.category, host, now), reason);
    if (!check.ok) return check;
    const until = now + settings.curfewExtMin * 60_000;
    await chrome.storage.session.set({ [S.ext]: { until } });
    await addEvent({ date: today(now), at: now, type: 'curfew-ext', reason: reason.trim(), site: siteKey(host), minutes: settings.curfewExtMin });
    chrome.alarms.create(A.extEnd, { when: until });
    void broadcast();
    return { ok: true };
  }

  async function markChannel(tabId: number, category: CategoryId): Promise<ActionResult> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const page = state.pages[tabId];
    const channel = tab?.url && page?.url === tab.url ? page.channel : undefined;
    if (!channel) return { ok: false, reason: 'no-channel' };
    const channels = (await config.getChannels()).filter((c) => channelKey(c) !== channelKey(channel));
    channels.push({ ...channel, category });
    await config.saveChannels(channels); // → onConfigChange：重载 + 对账 + 广播
    await addEvent({ date: today(), at: Date.now(), type: 'mark-channel', category, name: channel.name });
    return { ok: true };
  }

  async function goGerman(tabId: number): Promise<ActionResult> {
    const target = await continueGerman();
    if (!target) return { ok: false, reason: 'no-target' };
    await chrome.tabs.update(tabId, { url: target.url });
    await addEvent({ date: today(), at: Date.now(), type: 'go-german' });
    return { ok: true };
  }

  async function overrideTab(tabId: number, category: CategoryId): Promise<ActionResult> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) return { ok: false, reason: 'no-tab' };
    await apply({ type: 'override', override: { tabId, url: tab.url, category }, at: Date.now() });
    void notify(tabId);
    return { ok: true };
  }

  async function addRule(pattern: string, category: CategoryId): Promise<ActionResult> {
    if (!parsePattern(pattern)) return { ok: false, reason: 'bad-pattern' };
    const rules = (await config.getRules()).filter((r) => r.pattern !== pattern);
    const createdAt = rules.reduce((m, r) => Math.max(m, r.createdAt), 0) + 1;
    rules.push({ id: `r-${Date.now()}`, pattern, category, createdAt });
    await config.saveRules(rules);
    return { ok: true };
  }

  async function popupState(tabId: number | null): Promise<PopupState> {
    const now = Date.now();
    const totals = await liveTotals(now);
    let tab: PopupState['tab'] = null;
    if (tabId !== null) {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      const cls = t?.url ? classifyTab(tabId, t.url) : null;
      const host = t?.url ? hostOf(t.url) : null;
      if (t?.url && cls && host) {
        const page = state.pages[tabId];
        const timing = state.current?.tabId === tabId;
        tab = {
          tabId,
          url: t.url,
          host,
          category: cls.category,
          source: cls.source,
          channel: page && page.url === t.url ? page.channel : undefined,
          timing,
          liveSec: timing && state.current ? Math.round((now - state.current.startedAt) / 1000) : 0,
        };
      }
    }
    return {
      phase: phaseAt(now, settings.schedule),
      nextChangeAt: nextPhaseChange(now, settings.schedule),
      bedtime: formatHHMM(settings.schedule.bedtime),
      wake: formatHHMM(settings.schedule.wake),
      germanSec: totals.german,
      germanGoalMin: settings.germanGoalMin,
      driftSec: totals.drift,
      driftCapMin: settings.driftCapMin,
      privateUsed: await countEvents([today(now)], 'private-pass'),
      privatePerDay: settings.privatePerDay,
      totalSec: totals.german + totals.study + totals.drift + totals.private + totals.other,
      tab,
      continueGerman: await continueGerman(),
      incognitoAllowed: await chrome.extension.isAllowedIncognitoAccess(),
    };
  }

  // ---------- 推送与徽章 ----------

  async function notify(tabId: number): Promise<void> {
    await chrome.tabs.sendMessage(tabId, { type: 'policy-changed' }).catch(() => undefined);
  }

  async function broadcast(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter((t) => t.id != null && /^https?:/.test(t.url ?? '')).map((t) => notify(t.id!)));
  }

  async function updateBadge(): Promise<void> {
    const now = Date.now();
    const phase = phaseAt(now, settings.schedule);
    let text = '';
    let color = '#3ddc84';
    if (phase === 'curfew') {
      text = 'zZ';
      color = '#8b7cf6';
    } else if (phase === 'winddown') {
      text = String(Math.max(0, Math.ceil((nextOccurrence(now, settings.schedule.bedtime) - now) / 60_000)));
      color = '#ffb224';
    } else {
      const min = Math.floor((await liveTotals(now)).german / 60);
      text = min > 0 ? String(min) : '';
    }
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  }

  function schedulePhaseAlarm(): void {
    chrome.alarms.create(A.phase, { when: nextPhaseChange(Date.now(), settings.schedule) + 500 });
  }

  function scheduleDaycut(): void {
    chrome.alarms.create(A.daycut, { when: nextDayBoundary(Date.now(), settings.dayCutoffHour) + 1000 });
  }

  // ---------- 入口 ----------

  const ready = serial(async () => {
    await config.ensureDefaults();
    await loadConfig();
    const snap = await session<TrackerState | null>(S.tracker, null);
    if (snap) state = snap;
    await apply(await buildSyncEvent(settings.idleThresholdSec));
    chrome.alarms.create(A.heartbeat, { periodInMinutes: 0.5 });
    schedulePhaseAlarm();
    scheduleDaycut();
    await updateBadge();
  });

  wireEvents((ev) => {
    void ready.then(() =>
      serial(async () => {
        await apply(ev);
        await updateBadge();
      }),
    );
  });

  config.onConfigChange(() => {
    void ready.then(() =>
      serial(async () => {
        await loadConfig();
        // 完整对账而非只重分类：idle 阈值可能变了，必须按新阈值重新查询 idle 状态
        await apply(await buildSyncEvent(settings.idleThresholdSec));
        schedulePhaseAlarm();
        await updateBadge();
        void broadcast();
      }),
    );
  });

  chrome.alarms.onAlarm.addListener((a) => {
    void ready.then(() =>
      serial(async () => {
        if (a.name === A.heartbeat) {
          await apply({ type: 'heartbeat', at: Date.now() });
          // 额度在看的过程中耗尽：推给正在看的娱乐页（≤30s 精度）
          if (state.current?.category === 'drift') void notify(state.current.tabId);
        } else if (a.name === A.phase) {
          schedulePhaseAlarm();
          void broadcast();
        } else if (a.name === A.daycut) {
          await purgeSessionsOlderThan(90);
          scheduleDaycut();
        } else if (a.name.startsWith(A.passPrefix) || a.name === A.extEnd) {
          void broadcast();
        }
        await updateBadge();
      }),
    );
  });

  chrome.runtime.onInstalled.addListener(() => {
    // 已打开的标签页没有 content script：补注入（ADR-0013）
    void chrome.tabs.query({}).then((tabs) =>
      Promise.all(
        tabs
          .filter((t) => t.id != null && /^https?:/.test(t.url ?? ''))
          .map((t) => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: [GATE_SCRIPT] }).catch(() => undefined)),
      ),
    );
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void serial(async () => {
      const gates = await session<GateShown>(S.gates, {});
      if (gates[tabId]) {
        delete gates[tabId];
        await chrome.storage.session.set({ [S.gates]: gates });
      }
    });
  });

  chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    void ready
      .then(() => serial(() => route(msg, sender)))
      .then(sendResponse, (e: unknown) => sendResponse({ ok: false, reason: String(e) }));
    return true;
  });

  async function route(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? '';
    switch (msg.type) {
      case 'verdict':
        return tabId === undefined ? { verdict: { kind: 'allow' }, ctx: null } : verdictFor(tabId, msg.url);
      case 'page':
        if (tabId === undefined) return { ok: false, reason: 'no-tab' };
        await apply({ type: 'page', tabId, page: { url: msg.url, channel: msg.channel, mediaPlaying: msg.mediaPlaying }, at: Date.now() });
        return { ok: true };
      case 'grant':
        return tabId === undefined ? { ok: false, reason: 'no-tab' } : grant(tabId, url, msg.minutes, msg.intent);
      case 'retry':
        return retry(url);
      case 'curfew-ext':
        return tabId === undefined ? { ok: false, reason: 'no-tab' } : extendCurfew(tabId, url, msg.reason);
      case 'mark-channel': {
        const id = tabId ?? msg.tabId;
        return id === undefined ? { ok: false, reason: 'no-tab' } : markChannel(id, msg.category);
      }
      case 'go-german': {
        const id = tabId ?? msg.tabId;
        return id === undefined ? { ok: false, reason: 'no-tab' } : goGerman(id);
      }
      case 'private-skip':
        await addEvent({ date: today(), at: Date.now(), type: 'private-skip', intent: msg.action.slice(0, 40) });
        if (tabId !== undefined) await chrome.tabs.remove(tabId);
        return { ok: true };
      case 'close-tab':
        if (tabId !== undefined) await chrome.tabs.remove(tabId);
        return { ok: true };
      case 'popup-state':
        return popupState(msg.tabId);
      case 'override':
        return overrideTab(msg.tabId, msg.category);
      case 'add-rule':
        return addRule(msg.pattern, msg.category);
      default:
        return { ok: false, reason: 'unknown-message' };
    }
  }
});
