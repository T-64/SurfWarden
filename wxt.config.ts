import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SurfWarden',
    short_name: 'SurfWarden',
    description: '本地优先的网页时间统计与监督：分用途记录，而不是域名一刀切。',
    permissions: ['tabs', 'idle', 'alarms', 'storage'],
    host_permissions: ['<all_urls>'],
  },
});
