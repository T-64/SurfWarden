import type { CategoryId, ChannelSignal, Verdict } from '../src/core/types';
import type { ActionResult, GateContext, Msg, VerdictResponse } from '../src/shared/messages';

/**
 * 页面内遮罩（ADR-0013）：闸门 / 拦截 / 倒计时横幅 + 频道信号 + 媒体状态上报。
 * 判决全部来自 SW；这里只渲染。shadow root 隔离样式，挂在 <html> 下。
 */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const w = window as unknown as { __surfwardenGate?: boolean };
    if (w.__surfwardenGate || window.top !== window) return;
    w.__surfwardenGate = true;
    new Gate().start();
  },
});

const INTENTS = ['放松一下', '看一个具体的视频 / 直播', '查个东西'];

class Gate {
  private hostEl = document.createElement('surfwarden-gate');
  // open：E2E 可穿透定位；closed 并不更安全（页面脚本总能直接移除宿主元素）
  private root = this.hostEl.attachShadow({ mode: 'open' });
  private layer = document.createElement('div');
  private lastUrl = '';
  private sentChannelKey = '';
  private sentPlaying = false;
  private overlayOn = false;
  private savedOverflow = '';
  private timers: number[] = [];
  private bannerTimer = 0;
  private expiryTimer = 0;
  private dead = false;
  private renderKey = '';

  start(): void {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style, this.layer);
    this.mount();

    chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === 'policy-changed') void this.check();
    });

    this.onUrl();
    this.every(1000, () => {
      this.mount();
      if (location.href !== this.lastUrl) this.onUrl();
      if (this.overlayOn) pauseMedia();
    });
    this.every(30_000, () => void this.check());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
    for (const t of ['play', 'playing', 'pause', 'ended', 'emptied']) {
      document.addEventListener(t, () => this.reportMedia(), true);
    }
    window.addEventListener('keydown', (e) => this.swallowKeys(e), true);
    window.addEventListener('keyup', (e) => this.swallowKeys(e), true);
  }

  // ---------- 生命周期 ----------

  private every(ms: number, fn: () => void): void {
    this.timers.push(window.setInterval(fn, ms));
  }

  private mount(): void {
    if (!this.hostEl.isConnected && document.documentElement) document.documentElement.append(this.hostEl);
  }

  private shutdown(): void {
    // 扩展被重载/卸载：旧 content 失去上下文，彻底退场
    this.dead = true;
    this.timers.forEach(clearInterval);
    clearTimeout(this.bannerTimer);
    clearTimeout(this.expiryTimer);
    this.setOverlay(false);
    this.hostEl.remove();
  }

  private async send<T>(msg: Msg): Promise<T | null> {
    if (this.dead) return null;
    try {
      return (await chrome.runtime.sendMessage(msg)) as T;
    } catch {
      if (!chrome.runtime?.id) this.shutdown();
      return null;
    }
  }

  private onUrl(): void {
    this.lastUrl = location.href;
    this.sentChannelKey = '';
    void this.report();
    void this.check();
    // 视频页的频道区块是异步渲染的（实测 B 站 / YouTube 需 2–6s），多次补取
    for (const d of [1500, 3000, 5000, 8000, 12000]) {
      window.setTimeout(() => {
        if (location.href === this.lastUrl) void this.report(true);
      }, d);
    }
  }

  // ---------- 上报 ----------

  private async report(onlyIfChanged = false): Promise<void> {
    const channel = extractChannel();
    const key = channel ? `${channel.platform}:${channel.id}` : '';
    if (onlyIfChanged && key === this.sentChannelKey) return;
    this.sentChannelKey = key;
    this.sentPlaying = mediaPlaying();
    await this.send({ type: 'page', url: location.href, channel, mediaPlaying: this.sentPlaying });
    if (onlyIfChanged) await this.check();
  }

  private reportMedia(): void {
    if (mediaPlaying() !== this.sentPlaying) void this.report();
  }

  // ---------- 判决与渲染 ----------

  private async check(): Promise<void> {
    const r = await this.send<VerdictResponse>({ type: 'verdict', url: location.href });
    if (r?.verdict) this.render(r.verdict, r.ctx);
  }

  private render(v: Verdict, ctx: GateContext | null): void {
    clearTimeout(this.expiryTimer);
    const at = bannerDeadline(v);
    if (at !== null) this.expiryTimer = window.setTimeout(() => void this.check(), Math.max(0, at - Date.now()) + 300);

    // 同一判决不重绘，免得清掉用户正在输入的意图/理由
    const key = JSON.stringify([v.kind, v.kind === 'block' ? v.reason : '', v.kind === 'gate' ? v.options : '', ctx?.channel?.id, ctx?.category, ctx?.pass?.until]);
    if (key === this.renderKey && v.kind !== 'allow') return;
    this.renderKey = key;

    this.layer.replaceChildren();
    clearInterval(this.bannerTimer);
    if (v.kind === 'allow' || !ctx) {
      this.setOverlay(false);
      if (v.kind === 'allow' && v.banner) this.layer.append(this.banner(v.banner));
      if (ctx && askChannel(ctx)) this.layer.append(this.channelChip(ctx));
      return;
    }
    this.setOverlay(true);
    const card = v.kind === 'gate' ? this.gateCard(v, ctx) : this.blockCard(v, ctx);
    this.layer.append(el('div', { class: 'ov' }, card));
  }

  private setOverlay(on: boolean): void {
    if (on === this.overlayOn) return;
    this.overlayOn = on;
    const html = document.documentElement;
    if (on) {
      this.savedOverflow = html.style.overflow;
      html.style.setProperty('overflow', 'hidden', 'important');
      pauseMedia();
    } else {
      html.style.overflow = this.savedOverflow;
    }
  }

  private swallowKeys(e: KeyboardEvent): void {
    // 遮罩期间页面快捷键（空格播放、J/K/L）不生效；自己的输入框（事件重定向到 host）放行
    if (this.overlayOn && e.target !== this.hostEl) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  // ---------- 闸门 ----------

  private gateCard(v: Extract<Verdict, { kind: 'gate' }>, ctx: GateContext): HTMLElement {
    let intent = '';
    let minutes = v.options[0] ?? 0;
    let left = v.waitSec;

    const go = el('button', { class: 'btn primary', disabled: '' }) as HTMLButtonElement;
    const refresh = () => {
      const ready = left <= 0 && intent.trim() !== '' && minutes > 0;
      go.disabled = !ready;
      go.textContent = left > 0 ? `先停 ${left} 秒` : intent.trim() === '' ? '先写下你想干嘛' : `进入 · ${minutes} 分钟`;
    };
    const tick = window.setInterval(() => {
      left -= 1;
      refresh();
      if (left <= 0) clearInterval(tick);
    }, 1000);
    this.bannerTimer = tick;

    const custom = el('input', { class: 'input', placeholder: '或者自己写…', maxlength: '60' }) as HTMLInputElement;
    const chips = INTENTS.map((t) =>
      el('button', { class: 'chip' }, t, (b) => {
        b.addEventListener('click', () => {
          intent = t;
          custom.value = '';
          chips.forEach((c) => c.classList.toggle('on', c === b));
          refresh();
        });
      }),
    );
    custom.addEventListener('input', () => {
      intent = custom.value;
      chips.forEach((c) => c.classList.remove('on'));
      refresh();
    });

    const mins = v.options.map((m) =>
      el('button', { class: `chip${m === minutes ? ' on' : ''}` }, `${m} 分`, (b) => {
        b.addEventListener('click', () => {
          minutes = m;
          mins.forEach((c) => c.classList.toggle('on', c === b));
          refresh();
        });
      }),
    );

    go.addEventListener('click', async () => {
      go.disabled = true;
      const r = await this.send<ActionResult>({ type: 'grant', minutes, intent });
      if (r && !r.ok) {
        go.textContent = r.reason === 'too-early' ? '再等一下' : '没成功，再试一次';
        go.disabled = false;
      }
      await this.check();
    });
    refresh();

    return el(
      'div',
      { class: 'card' },
      this.header(ctx, `今天第 ${v.passesToday + 1} 次 · 已用 ${ctx.driftUsedMin}/${ctx.driftCapMin} 分`),
      el('h1', {}, '你本来想干嘛？'),
      el('div', { class: 'row wrap' }, ...chips),
      custom,
      el('h2', {}, '看多久？'),
      el('div', { class: 'row' }, ...mins),
      go,
      el('div', { class: 'sep' }),
      ...this.exits(ctx),
      ...(askChannel(ctx) ? [this.channelAsk(ctx)] : []),
    );
  }

  // ---------- 拦截 ----------

  private blockCard(v: Extract<Verdict, { kind: 'block' }>, ctx: GateContext): HTMLElement {
    const now = Date.now();
    const parts: HTMLElement[] = [];
    if (v.reason === 'expired') {
      parts.push(
        el('h1', {}, '⏱ 时间到'),
        el('p', { class: 'sub' }, ctx.pass ? `你说要「${ctx.pass.intent}」，${ctx.pass.minutes} 分钟。` : '这张通行证用完了。'),
        ...this.exits(ctx),
      );
      if (v.canRetry) {
        parts.push(
          el('button', { class: 'link' }, '再申请一次（会等更久）', (b) =>
            b.addEventListener('click', async () => {
              await this.send({ type: 'retry' });
              await this.check();
            }),
          ),
        );
      }
    } else if (v.reason === 'cap') {
      parts.push(el('h1', {}, '今天的娱乐额度用完了'), el('p', { class: 'sub' }, `已用 ${ctx.driftUsedMin} / ${ctx.driftCapMin} 分钟。明天再来。`), ...this.exits(ctx));
    } else if (v.reason === 'winddown') {
      const left = Math.max(0, Math.ceil((todayAt(ctx.bedtime) - now) / 60_000));
      parts.push(
        el('h1', {}, `离上床还有 ${left} 分钟`),
        el('p', { class: 'sub' }, `收尾时间，娱乐站已关闭。把手头的事收个尾，${ctx.bedtime} 上床。`),
        this.closeBtn('primary'),
      );
    } else {
      const lateMin = Math.max(0, Math.round((now - lastAt(ctx.bedtime)) / 60_000));
      parts.push(
        el('h1', {}, `${clock(now)} · 该睡了`),
        el('p', { class: 'sub' }, `已过就寝时间（${ctx.bedtime}）${lateMin} 分钟。明早 ${ctx.wake} 起床。`),
        this.closeBtn('primary'),
      );
      if (ctx.category === 'drift') parts.push(el('p', { class: 'note' }, '娱乐站在宵禁期间不能延长。'));
      else if (v.canExtend) parts.push(this.extendForm(ctx));
      else parts.push(el('p', { class: 'note' }, '今晚的延长已经用过了。'));
    }
    // 白天的拦截（额度用完 / 时间到）仍可把频道标为德语或学业；夜间不给，免得成为绕过宵禁的后门
    if ((v.reason === 'cap' || v.reason === 'expired') && askChannel(ctx)) parts.push(this.channelAsk(ctx));
    return el('div', { class: 'card' }, this.header(ctx, `德语今天 ${ctx.germanTodayMin}/${ctx.germanGoalMin} 分`), ...parts);
  }

  private extendForm(ctx: GateContext): HTMLElement {
    const input = el('input', { class: 'input', placeholder: '真有正事？写下来（会记进报告）', maxlength: '80' }) as HTMLInputElement;
    const btn = el('button', { class: 'btn ghost', disabled: '' }, `延长 ${ctx.curfewExtMin} 分钟（今晚仅 1 次）`) as HTMLButtonElement;
    input.addEventListener('input', () => (btn.disabled = input.value.trim().length < 4));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await this.send({ type: 'curfew-ext', reason: input.value });
      await this.check();
    });
    return el('div', { class: 'ext' }, input, btn);
  }

  // ---------- 公共部件 ----------

  private header(ctx: GateContext, meta: string): HTMLElement {
    return el('div', { class: 'head' }, el('span', { class: `cat ${ctx.category}` }, `${CAT_NAME[ctx.category]} · ${ctx.site}`), el('span', { class: 'meta' }, meta));
  }

  private exits(ctx: GateContext): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (ctx.continueGerman) {
      out.push(
        el('button', { class: 'btn german' }, `去学德语 · ${ctx.continueGerman.name} →`, (b) =>
          b.addEventListener('click', () => void this.send({ type: 'go-german' })),
        ),
      );
    }
    out.push(this.closeBtn('ghost'));
    return out;
  }

  private closeBtn(kind: 'primary' | 'ghost'): HTMLElement {
    return el('button', { class: `btn ${kind}` }, '关掉这个标签页', (b) => b.addEventListener('click', () => void this.send({ type: 'close-tab' })));
  }

  private channelAsk(ctx: GateContext): HTMLElement {
    return el(
      'div',
      { class: 'ask' },
      el('span', {}, `${ctx.channel!.platform === 'bilibili' ? 'UP 主' : '频道'}「${ctx.channel!.name}」其实是：`),
      ...(['german', 'study'] as const).map((c) =>
        el('button', { class: `chip ${c}` }, c === 'german' ? '德语学习' : '学业', (b) =>
          b.addEventListener('click', async () => {
            await this.send({ type: 'mark-channel', category: c });
            await this.check();
          }),
        ),
      ),
    );
  }

  /** 放行状态下的小卡片：只在娱乐页、频道未归类时出现 */
  private channelChip(ctx: GateContext): HTMLElement {
    const box = el('div', { class: 'chipbox' }, this.channelAsk(ctx));
    box.append(
      el('button', { class: 'chip' }, '就是娱乐', (b) =>
        b.addEventListener('click', async () => {
          await this.send({ type: 'mark-channel', category: 'drift' });
          await this.check();
        }),
      ),
    );
    return box;
  }

  private banner(b: NonNullable<Extract<Verdict, { kind: 'allow' }>['banner']>): HTMLElement {
    const pill = el('div', { class: `banner ${b.kind}` });
    const paint = () => {
      const now = Date.now();
      if (b.kind === 'pass') pill.textContent = `娱乐通行证 · 剩 ${mmss(b.until - now)}`;
      else if (b.kind === 'ext') pill.textContent = `宵禁延长 · 剩 ${mmss(b.until - now)}`;
      else if (b.kind === 'winddown') pill.textContent = `离上床 ${Math.max(0, Math.ceil((b.bedtimeAt - now) / 60_000))} 分钟`;
      else pill.textContent = `已过就寝 ${Math.max(0, Math.round((now - b.since) / 60_000))} 分钟`;
    };
    paint();
    this.bannerTimer = window.setInterval(paint, 1000);
    return pill;
  }
}

// ---------- 页面探测 ----------

/** 频道提取（选择器 2026-10-14 在真实页面核实，见 architecture §4） */
export function extractChannel(): ChannelSignal | undefined {
  const host = location.hostname;
  if (/(^|\.)bilibili\.com$/.test(host) && location.pathname.startsWith('/video/')) {
    const a = document.querySelector<HTMLAnchorElement>('.up-panel-container a.up-name, a.up-name');
    const mid = /space\.bilibili\.com\/(\d+)/.exec(a?.getAttribute('href') ?? '')?.[1];
    if (a && mid) {
      const author = document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content;
      return { platform: 'bilibili', id: mid, name: a.textContent?.trim() || author || mid };
    }
  }
  if (/(^|\.)youtube\.com$/.test(host) && location.pathname === '/watch') {
    const a = document.querySelector<HTMLAnchorElement>('ytd-watch-metadata ytd-channel-name a[href^="/@"], ytd-watch-metadata ytd-channel-name a[href^="/channel/"]');
    const href = a?.getAttribute('href') ?? '';
    const id = href.startsWith('/@') ? href.slice(1).split(/[/?#]/)[0] : href.split('/')[2];
    if (a && id) return { platform: 'youtube', id, name: a.textContent?.trim() || id };
  }
  return undefined;
}

function mediaPlaying(): boolean {
  if (document.visibilityState !== 'visible') return false;
  return [...document.querySelectorAll<HTMLMediaElement>('video, audio')].some((m) => !m.paused && !m.ended && m.readyState > 2);
}

function pauseMedia(): void {
  document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
    if (!m.paused) m.pause();
  });
}

function askChannel(ctx: GateContext): boolean {
  return ctx.channel !== undefined && ctx.source !== 'channel' && ctx.source !== 'manual' && ctx.category === 'drift';
}

function bannerDeadline(v: Verdict): number | null {
  if (v.kind !== 'allow' || !v.banner) return null;
  if (v.banner.kind === 'pass' || v.banner.kind === 'ext') return v.banner.until;
  if (v.banner.kind === 'winddown') return v.banner.bedtimeAt;
  return null;
}

// ---------- 小工具 ----------

const CAT_NAME: Record<CategoryId, string> = { german: '德语', study: '学业', drift: '娱乐', other: '其他' };

function el(tag: string, attrs: Record<string, string>, ...children: Array<Node | string | ((e: HTMLElement) => void)>): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === 'function') c(e);
    else e.append(c);
  }
  return e;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayAt(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
}

/** 最近一次（≤ now）的 hh:mm */
function lastAt(hhmm: string): number {
  const t = todayAt(hhmm);
  return t <= Date.now() ? t : t - 86_400_000;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ov { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
  background: rgba(8, 9, 11, 0.94); backdrop-filter: blur(8px);
  font: 14px/1.6 -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #c9ced6; }
.card { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: #131518;
  border: 1px solid #262b31; border-radius: 12px; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
.cat { padding: 2px 8px; border-radius: 6px; background: #20242a; color: #f2f4f7; }
.cat.drift { box-shadow: inset 2px 0 0 #d9732f; } .cat.german { box-shadow: inset 2px 0 0 #1fa67a; }
.cat.study { box-shadow: inset 2px 0 0 #4f8de0; } .cat.other { box-shadow: inset 2px 0 0 #6b717a; }
.meta { color: #8b929c; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
h1 { margin: 8px 0 0; font-size: 22px; line-height: 1.3; color: #f2f4f7; font-weight: 650; }
h2 { margin: 6px 0 0; font-size: 13px; color: #8b929c; font-weight: 600; }
.sub { margin: 0 0 6px; color: #c9ced6; }
.note { margin: 0; font-size: 12px; color: #8b929c; }
.row { display: flex; gap: 8px; } .row.wrap { flex-wrap: wrap; }
.chip { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px; border: 1px solid #2d333b;
  color: #c9ced6; font-size: 13px; }
.chip:hover { border-color: #565d68; } .chip.on { border-color: #f2f4f7; color: #f2f4f7; background: #20242a; }
.chip.german { border-color: rgba(31,166,122,.6); color: #3ddc84; } .chip.study { border-color: rgba(79,141,224,.6); color: #7fb0f0; }
.input { all: unset; padding: 8px 12px; border-radius: 8px; border: 1px solid #2d333b; color: #f2f4f7; font-size: 13px; }
.input:focus { border-color: #8b929c; }
.btn { all: unset; cursor: pointer; text-align: center; padding: 11px 14px; border-radius: 9px; font-size: 14px; font-weight: 600; }
.btn[disabled] { cursor: default; opacity: 0.45; }
.btn.primary { background: #f2f4f7; color: #0b0c0e; }
.btn.ghost { border: 1px solid #2d333b; color: #c9ced6; font-weight: 500; }
.btn.german { background: #3ddc84; color: #04130a; }
.link { all: unset; cursor: pointer; align-self: center; font-size: 12px; color: #565d68; padding: 4px; }
.link:hover { color: #8b929c; }
.sep { height: 1px; background: #262b31; margin: 6px 0; }
.ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: #8b929c; }
.ext { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
.banner, .chipbox { position: fixed; right: 16px; z-index: 2147483647; background: rgba(19, 21, 24, 0.94);
  border: 1px solid #262b31; border-radius: 999px; color: #c9ced6; pointer-events: none;
  font: 12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace; padding: 6px 12px; }
.banner { bottom: 16px; }
.banner.winddown { color: #ffb224; border-color: rgba(255,178,36,.4); }
.banner.late, .banner.ext { color: #a99cf8; border-color: rgba(139,124,246,.45); }
.chipbox { bottom: 52px; border-radius: 12px; pointer-events: auto; padding: 8px 12px; max-width: 340px;
  font-family: -apple-system, 'PingFang SC', sans-serif; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chipbox .ask { margin: 0; }
`;
