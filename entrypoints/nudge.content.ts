export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; text?: string; ratio?: number } | null;
      if (m?.type === 'sw-nudge' && m.text) showBanner(m.text, m.ratio);
      return false; // 同步、无异步响应
    });

    /** 非侵入顶部横幅（shadow DOM 隔离样式），6 秒自动消失 */
    function showBanner(text: string, ratio?: number): void {
      document.getElementById('surfwarden-nudge')?.remove();
      const host = document.createElement('div');
      host.id = 'surfwarden-nudge';
      host.style.cssText =
        'all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647; pointer-events: none;';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        .bar {
          margin: 10px auto 0; max-width: 560px; width: calc(100% - 24px);
          box-sizing: border-box; padding: 10px 16px; border-radius: 10px;
          background: rgba(19, 21, 24, 0.96); color: #c9ced6;
          border: 1px solid #262b31;
          font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          display: flex; align-items: center; gap: 10px;
          animation: sw-in 0.25s ease-out;
        }
        .bar .tag {
          font: 600 10px/1 ui-monospace, Menlo, monospace; letter-spacing: 0.08em;
          color: #ffb224; border: 1px solid rgba(255,178,36,0.3);
          padding: 3px 7px; border-radius: 4px; flex: none;
        }
        @keyframes sw-in { from { transform: translateY(-8px); opacity: 0; } }
      `;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'NUDGE';
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1; min-width:0;';
      wrap.appendChild(document.createTextNode(text));
      if (ratio !== undefined) {
        const meter = document.createElement('div');
        meter.style.cssText =
          'margin-top:6px; height:3px; border-radius:99px; background:rgba(255,255,255,0.08); overflow:hidden;';
        const fill = document.createElement('i');
        fill.style.cssText = `display:block; height:100%; width:${Math.round(ratio * 100)}%; background:#ffb224; border-radius:99px;`;
        meter.appendChild(fill);
        wrap.appendChild(meter);
      }
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.append(tag, wrap);
      shadow.append(style, bar);
      document.documentElement.appendChild(host);
      window.setTimeout(() => host.remove(), 6_000);
    }
  },
});
