import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SurfWarden',
    short_name: 'SurfWarden',
    description: '本地优先的网页时间统计与监督：分用途记录，而不是域名一刀切。',
    permissions: ['tabs', 'idle', 'alarms', 'storage', 'declarativeNetRequest'],
    host_permissions: ['<all_urls>'],
    // DNR 重定向到引导页的前提（references.md §3）
    web_accessible_resources: [
      { resources: ['guide.html'], matches: ['<all_urls>'] },
    ],
  },
});
