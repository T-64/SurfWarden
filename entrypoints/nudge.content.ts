export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as { type?: string; text?: string } | null;
      if (m?.type === 'sw-nudge' && m.text) showBanner(m.text);
      return false; // 同步、无异步响应
    });

    /** 非侵入顶部横幅（shadow DOM 隔离样式），6 秒自动消失 */
    function showBanner(text: string): void {
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
          background: rgba(17, 24, 39, 0.92); color: #f9fafb;
          font: 13px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          box-shadow: 0 6px 24px rgba(0,0,0,0.25);
          animation: sw-in 0.25s ease-out;
        }
        @keyframes sw-in { from { transform: translateY(-8px); opacity: 0; } }
      `;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.textContent = `⏳ ${text}`;
      shadow.append(style, bar);
      document.documentElement.appendChild(host);
      window.setTimeout(() => host.remove(), 6_000);
    }
  },
});
