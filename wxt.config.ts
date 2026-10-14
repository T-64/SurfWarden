import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SurfWarden',
    short_name: 'SurfWarden',
    description: '按时下线，把刷 B 站和 X 的时间换成学德语。全部数据只在本机。',
    // scripting：安装/更新后给已打开的标签页补注入遮罩脚本（ADR-0013）
    permissions: ['tabs', 'idle', 'alarms', 'storage', 'scripting'],
    host_permissions: ['<all_urls>'],
  },
});
