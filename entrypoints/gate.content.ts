import type { CategoryId, ChannelSignal, Verdict } from '../src/core/types';
import type { ActionResult, GateContext, Msg, VerdictResponse } from '../src/shared/messages';
import themeCss from '../src/shared/theme.css?raw';

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
/** 私密冷静期：离开屏幕做的事（用户的原话：冷水洗脸、俯卧撑） */
const ACTIONS = ['用冷水洗把脸', '做 15 个俯卧撑', '喝杯水，站起来走走'];

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
  private tick = 0;
  private expiryTimer = 0;
  private dead = false;
  private renderKey = '';

  start(): void {
    const style = document.createElement('style');
    style.textContent = themeCss + CSS;
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
    clearInterval(this.tick);
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

    // 同一判决不重绘，免得清掉用户正在输入的意图/理由、重置倒计时
    const key = JSON.stringify([
      v.kind,
      v.kind === 'block' ? [v.reason, v.canExtend, v.canRetry] : '',
      v.kind === 'gate' ? v.options : '',
      ctx?.channel?.id,
      ctx?.category,
      ctx?.pass?.until,
      ctx?.phase,
    ]);
    if (key === this.renderKey && v.kind !== 'allow') return;
    this.renderKey = key;

    this.layer.replaceChildren();
    this.layer.className = 'sw';
    this.layer.dataset.mood = ctx && ctx.phase !== 'day' ? 'night' : 'day';
    clearInterval(this.tick);
    if (v.kind === 'allow' || !ctx) {
      this.setOverlay(false);
      if (v.kind === 'allow' && v.banner) this.layer.append(this.banner(v.banner));
      if (ctx && askChannel(ctx)) this.layer.append(this.channelChip(ctx));
      return;
    }
    this.setOverlay(true);
    const sheet =
      v.kind === 'gate' ? this.gateSheet(v, ctx) : v.kind === 'cooldown' ? this.cooldownSheet(v, ctx) : this.blockSheet(v, ctx);
    this.layer.append(el('div', { class: 'ov' }, sheet));
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

  /** 每秒刷新的倒计时；返回"是否已到点" */
  private countdown(seconds: number, paint: (left: number) => void): void {
    let left = seconds;
    paint(left);
    this.tick = window.setInterval(() => {
      left -= 1;
      paint(left);
      if (left <= 0) clearInterval(this.tick);
    }, 1000);
  }

  // ---------- 娱乐：意图闸门 ----------

  private gateSheet(v: Extract<Verdict, { kind: 'gate' }>, ctx: GateContext): HTMLElement {
    let intent = '';
    let minutes = v.options[0] ?? 0;
    let left = v.waitSec;

    const go = el('button', { class: 'sw-btn sw-btn-primary full go', disabled: '' }) as HTMLButtonElement;
    const refresh = () => {
      go.disabled = !(left <= 0 && intent.trim() !== '' && minutes > 0);
      go.textContent = left > 0 ? `先停 ${left} 秒` : intent.trim() === '' ? '先写下你想干嘛' : `进入 · ${minutes} 分钟`;
    };

    const custom = el('input', { class: 'sw-input', placeholder: '或者自己写一句…', maxlength: '60' }) as HTMLInputElement;
    const chips = INTENTS.map((t) =>
      el('button', { class: 'sw-chip' }, t, (b) =>
        b.addEventListener('click', () => {
          intent = t;
          custom.value = '';
          chips.forEach((c) => c.classList.toggle('on', c === b));
          refresh();
        }),
      ),
    );
    custom.addEventListener('input', () => {
      intent = custom.value;
      chips.forEach((c) => c.classList.remove('on'));
      refresh();
    });
    const mins = v.options.map((m) =>
      el('button', { class: `sw-chip${m === minutes ? ' on' : ''}` }, `${m} 分钟`, (b) =>
        b.addEventListener('click', () => {
          minutes = m;
          mins.forEach((c) => c.classList.toggle('on', c === b));
          refresh();
        }),
      ),
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
    this.countdown(v.waitSec, (l) => {
      left = l;
      refresh();
    });

    return this.sheet(
      ctx,
      `今天第 ${v.passesToday + 1} 次 · 已用 ${ctx.driftUsedMin} / ${ctx.driftCapMin} 分`,
      el('h1', { class: 'sw-title' }, '你本来想干嘛？'),
      el('div', { class: 'row wrap' }, ...chips),
      custom,
      el('p', { class: 'sw-label gap' }, '看多久'),
      el('div', { class: 'row wrap' }, ...mins),
      go,
      ...this.alternatives(ctx),
      ...(askChannel(ctx) ? [this.channelAsk(ctx)] : []),
    );
  }

  // ---------- 私密：冷静期 ----------

  private cooldownSheet(v: Extract<Verdict, { kind: 'cooldown' }>, _ctx: GateContext): HTMLElement {
    let action = '';
    const clock = el('div', { class: 'sw-num cool-clock' });
    const title = el('h1', { class: 'sw-title' }, '先离开屏幕三分钟。');
    const sub = el('p', { class: 'lead' }, '不急着决定。起身做完下面一件事再回来，看你还想不想。');
    const enter = el('button', { class: 'sw-btn sw-btn-ghost full', disabled: '' }) as HTMLButtonElement;
    const leave = el('button', { class: 'sw-btn sw-btn-primary full' }, '不想了，关掉') as HTMLButtonElement;

    const rows = ACTIONS.map((a, i) =>
      el('button', { class: 'act' }, el('span', { class: 'sw-num idx' }, String(i + 1).padStart(2, '0')), el('span', {}, a), (b) =>
        b.addEventListener('click', () => {
          action = a;
          rows.forEach((r) => r.classList.toggle('on', r === b));
        }),
      ),
    );

    leave.addEventListener('click', () => void this.send({ type: 'private-skip', action: action || '直接离开' }));
    enter.addEventListener('click', async () => {
      enter.disabled = true;
      await this.send({ type: 'grant', minutes: v.passMin, intent: action || '冷静后进入' });
      await this.check();
    });

    this.countdown(v.waitSec, (left) => {
      clock.textContent = mmss(left * 1000);
      if (left <= 0) {
        clock.classList.add('done');
        title.textContent = '现在还想吗？';
        sub.textContent = '两个答案都可以。只是这一次，是你自己决定的。';
        enter.disabled = false;
        enter.textContent = `还是要看 · ${v.passMin} 分钟（今天 ${v.usedToday + 1}/${v.limit}）`;
      } else {
        enter.textContent = `冷静期 · 还剩 ${mmss(left * 1000)}`;
      }
    });

    return el(
      'div',
      { class: 'sheet' },
      el('div', { class: 'head' }, el('span', { class: 'tag' }, el('span', { class: 'sw-swatch hatch' }), '私密'), el('span', { class: 'meta' }, `今天 ${v.usedToday}/${v.limit} 次`)),
      clock,
      title,
      sub,
      el('div', { class: 'acts' }, ...rows),
      leave,
      enter,
      el('button', { class: 'sw-btn-quiet center' }, '或者去学会儿德语', (b) => b.addEventListener('click', () => void this.send({ type: 'go-german' }))),
    );
  }

  // ---------- 拦截 ----------

  private blockSheet(v: Extract<Verdict, { kind: 'block' }>, ctx: GateContext): HTMLElement {
    const now = Date.now();
    const priv = ctx.category === 'private';
    const parts: HTMLElement[] = [];

    if (v.reason === 'curfew' || v.reason === 'winddown') {
      const curfew = v.reason === 'curfew';
      const lateMin = Math.max(0, Math.round((now - lastAt(ctx.bedtime)) / 60_000));
      const toBed = Math.max(0, Math.ceil((todayAt(ctx.bedtime) - now) / 60_000));
      parts.push(
        el('div', { class: 'sw-num night-clock' }, clock(now)),
        el('h1', { class: 'sw-title' }, curfew ? '该睡了。' : `离上床还有 ${toBed} 分钟。`),
        el(
          'p',
          { class: 'lead' },
          curfew ? `已经过了就寝时间（${ctx.bedtime}）${lateMin} 分钟。明早 ${ctx.wake} 起床。` : `收尾时间，娱乐站先关了。把手头的事收个尾，${ctx.bedtime} 上床。`,
        ),
        this.closeBtn('primary'),
      );
      if (curfew) {
        if (ctx.category === 'drift' || priv) parts.push(el('p', { class: 'sw-note center' }, '这类网站在宵禁期间不能延长。'));
        else if (v.canExtend) parts.push(this.extendForm(ctx));
        else parts.push(el('p', { class: 'sw-note center' }, '今晚的延长已经用过了。'));
      }
      return this.sheet(ctx, '', ...parts);
    }

    if (v.reason === 'expired') {
      parts.push(
        el('h1', { class: 'sw-title' }, '时间到。'),
        el('p', { class: 'lead' }, ctx.pass && !priv ? `你说要「${ctx.pass.intent}」，${ctx.pass.minutes} 分钟。` : `说好的 ${ctx.pass?.minutes ?? ''} 分钟到了。`),
      );
      if (priv) parts.push(this.closeBtn('primary'));
      else parts.push(...this.exits(ctx));
      if (v.canRetry) {
        parts.push(
          el('button', { class: 'sw-btn-quiet center' }, priv ? '再来一次（需要重新冷静）' : '再申请一次（会等更久）', (b) =>
            b.addEventListener('click', async () => {
              await this.send({ type: 'retry' });
              await this.check();
            }),
          ),
        );
      }
    } else if (v.reason === 'private-limit') {
      parts.push(el('h1', { class: 'sw-title' }, '今天的次数用过了。'), el('p', { class: 'lead' }, '明天再说。'), this.closeBtn('primary'));
    } else {
      parts.push(
        el('h1', { class: 'sw-title' }, '今天的娱乐额度用完了。'),
        el('p', { class: 'lead' }, `已用 ${ctx.driftUsedMin} / ${ctx.driftCapMin} 分钟，明天再来。`),
        ...this.exits(ctx),
      );
    }
    // 白天的拦截（额度用完 / 时间到）仍可把频道标为德语或学业；夜间不给，免得成为绕过宵禁的后门
    if ((v.reason === 'cap' || v.reason === 'expired') && askChannel(ctx)) parts.push(this.channelAsk(ctx));
    return this.sheet(ctx, priv ? '' : `德语今天 ${ctx.germanTodayMin} / ${ctx.germanGoalMin} 分`, ...parts);
  }

  private extendForm(ctx: GateContext): HTMLElement {
    const input = el('input', { class: 'sw-input', placeholder: '真有正事？写下来（会记进报告）', maxlength: '80' }) as HTMLInputElement;
    const btn = el('button', { class: 'sw-btn sw-btn-ghost full', disabled: '' }, `延长 ${ctx.curfewExtMin} 分钟 · 今晚仅一次`) as HTMLButtonElement;
    input.addEventListener('input', () => (btn.disabled = input.value.trim().length < 4));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await this.send({ type: 'curfew-ext', reason: input.value });
      await this.check();
    });
    return el('div', { class: 'ext' }, input, btn);
  }

  // ---------- 公共部件 ----------

  private sheet(ctx: GateContext, meta: string, ...children: HTMLElement[]): HTMLElement {
    const priv = ctx.category === 'private';
    const tag = el(
      'span',
      { class: 'tag' },
      el('span', { class: `sw-swatch${priv ? ' hatch' : ''}`, style: priv ? '' : `background: ${CAT_COLOR[ctx.category]}` }),
      priv ? '私密' : `${CAT_NAME[ctx.category]} · ${ctx.site}`,
    );
    return el('div', { class: 'sheet' }, el('div', { class: 'head' }, tag, el('span', { class: 'meta' }, meta)), ...children);
  }

  /** 正路在前：去学德语（实心）> 关掉（描边） */
  private exits(ctx: GateContext): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (ctx.continueGerman) {
      out.push(
        el('button', { class: 'sw-btn sw-btn-cta full' }, `去学德语 · ${ctx.continueGerman.name}`, (b) =>
          b.addEventListener('click', () => void this.send({ type: 'go-german' })),
        ),
      );
    }
    out.push(this.closeBtn('ghost'));
    return out;
  }

  /** 闸门下方的"另一条路"：分隔线 + 德语 + 关掉 */
  private alternatives(ctx: GateContext): HTMLElement[] {
    return [el('div', { class: 'or' }, el('span', {}, '或者')), ...this.exits(ctx)];
  }

  private closeBtn(kind: 'primary' | 'ghost'): HTMLElement {
    return el('button', { class: `sw-btn sw-btn-${kind} full` }, '关掉这个标签页', (b) => b.addEventListener('click', () => void this.send({ type: 'close-tab' })));
  }

  private channelAsk(ctx: GateContext): HTMLElement {
    return el(
      'div',
      { class: 'ask' },
      el('span', {}, `${ctx.channel!.platform === 'bilibili' ? 'UP 主' : '频道'}「${ctx.channel!.name}」其实是`),
      ...(['german', 'study'] as const).map((c) =>
        el('button', { class: 'sw-chip small' }, c === 'german' ? '德语学习' : '学业', (b) =>
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
    box.firstElementChild!.append(
      el('button', { class: 'sw-chip small' }, '就是娱乐', (b) =>
        b.addEventListener('click', async () => {
          await this.send({ type: 'mark-channel', category: 'drift' });
          await this.check();
        }),
      ),
    );
    return box;
  }

  private banner(b: NonNullable<Extract<Verdict, { kind: 'allow' }>['banner']>): HTMLElement {
    const label = el('span', { class: 'b-label' });
    const value = el('span', { class: 'sw-num b-value' });
    const pill = el('div', { class: `banner ${b.kind}` }, label, value);
    const paint = () => {
      const now = Date.now();
      if (b.kind === 'pass') {
        label.textContent = '剩';
        value.textContent = mmss(b.until - now);
      } else if (b.kind === 'ext') {
        label.textContent = '延长剩';
        value.textContent = mmss(b.until - now);
      } else if (b.kind === 'winddown') {
        label.textContent = '离上床';
        value.textContent = `${Math.max(0, Math.ceil((b.bedtimeAt - now) / 60_000))} 分`;
      } else {
        label.textContent = '已过就寝';
        value.textContent = `${Math.max(0, Math.round((now - b.since) / 60_000))} 分`;
      }
    };
    paint();
    this.tick = window.setInterval(paint, 1000);
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

const CAT_NAME: Record<CategoryId, string> = { german: '德语', study: '学业', drift: '娱乐', private: '私密', other: '其他' };
const CAT_COLOR: Record<CategoryId, string> = {
  german: 'var(--c-german)',
  study: 'var(--c-study)',
  drift: 'var(--c-drift)',
  private: 'var(--hatch)',
  other: 'var(--c-other)',
};

function el(tag: string, attrs: Record<string, string>, ...children: Array<Node | string | ((e: HTMLElement) => void)>): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== '' || k === 'disabled') e.setAttribute(k, v);
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
.ov {
  position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
  background: var(--backdrop); backdrop-filter: blur(14px) saturate(0.6); -webkit-backdrop-filter: blur(14px) saturate(0.6);
  animation: sw-in 0.22s ease-out;
}
@keyframes sw-in { from { opacity: 0; } to { opacity: 1; } }
.sheet {
  width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto;
  background: var(--surface); border: 1px solid var(--line); border-radius: 24px; box-shadow: var(--shadow);
  padding: 30px 32px 26px; display: flex; flex-direction: column; gap: 12px;
  animation: sw-up 0.28s cubic-bezier(.2,.8,.2,1);
}
@keyframes sw-up { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
.tag { display: inline-flex; align-items: center; gap: 8px; font: 500 12.5px/1 var(--sans); color: var(--mute); }
.meta { font: 12px/1 var(--sans); color: var(--faint); }
.sw-title { font-size: 30px; }
.lead { margin: 0 0 6px; font: 15px/1.65 var(--sans); color: var(--body); }
.row { display: flex; gap: 8px; } .row.wrap { flex-wrap: wrap; }
.gap { margin: 8px 0 0; }
.full { width: 100%; }
.go { margin-top: 10px; }
.center { align-self: center; text-align: center; }
.or { display: flex; align-items: center; gap: 12px; color: var(--faint); font: 12px var(--sans); margin: 10px 0 2px; }
.or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.sw-chip.small { padding: 6px 11px; font-size: 12px; }
.ask { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--line); font: 12.5px var(--sans); color: var(--mute); }
.ext { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-top: 16px; border-top: 1px solid var(--line); }
.hatch { background: var(--c-private); border: 1px solid var(--hatch); }

.night-clock { font-size: 76px; line-height: 1; font-weight: 400; color: var(--moon, var(--ink)); margin: 4px 0 6px; }
.cool-clock { font-size: 64px; line-height: 1; font-weight: 400; color: var(--ink); margin: 2px 0 4px; transition: color .3s; }
.cool-clock.done { color: var(--c-german); }
.acts { display: flex; flex-direction: column; border-top: 1px solid var(--line); margin: 4px 0 8px; }
.act {
  appearance: none; display: flex; align-items: center; gap: 14px; text-align: left; cursor: pointer;
  padding: 13px 4px; border: 0; border-bottom: 1px solid var(--line); background: transparent;
  font: 15px/1.3 var(--serif); color: var(--body);
}
.act:hover { color: var(--ink); }
.act .idx { font-size: 13px; color: var(--faint); width: 22px; }
.act.on { color: var(--ink); }
.act.on .idx { color: var(--c-german); }
.act.on::after { content: '✓'; margin-left: auto; color: var(--c-german); font-family: var(--sans); }

.banner, .chipbox {
  position: fixed; right: 18px; z-index: 2147483647; background: var(--surface); color: var(--body);
  border: 1px solid var(--line); box-shadow: var(--shadow);
}
.banner {
  bottom: 18px; pointer-events: none; border-radius: 999px; padding: 8px 14px 8px 16px;
  display: inline-flex; align-items: baseline; gap: 8px; font: 12px/1 var(--sans);
}
.b-label { color: var(--mute); }
.b-value { font-size: 17px; color: var(--ink); }
.banner.winddown .b-value { color: var(--warn); }
.banner.late .b-value, .banner.ext .b-value { color: var(--nightfall); }
.chipbox { bottom: 66px; border-radius: 16px; padding: 4px 14px 12px; max-width: 360px; }
.chipbox .ask { border-top: 0; }
`;
