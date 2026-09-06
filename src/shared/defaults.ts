import type { Category, Rule, Settings } from '../core/types';

/** 默认配置——首次安装时写入 storage（configStore.ensureDefaults）。 */

export const DEFAULT_SETTINGS: Settings = {
  dayCutoffHour: 0,
  idleGraceSec: 60,
  idleThresholdSec: 60,
  exemptPerDay: 2,
  exemptMinutes: 5,
  accent: 'signal',
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'learning', name: '学习', color: '#3ddc84', action: 'track' },
  { id: 'work', name: '工作', color: '#57c1ff', action: 'track' },
  { id: 'entertainment', name: '娱乐', color: '#ff5c5c', budgetMin: 45, action: 'nudge' },
  { id: 'neutral', name: '中性', color: '#8b929c', action: 'track' },
];

/**
 * v0.1 种子规则：装上就能看到有意义的统计；正式的模板包导入在 v0.3 options 页。
 * 注意 B 站先整域娱乐，/video/ 路径单独成规则便于用户改判（Q2 保守默认：先提醒不封锁）。
 */
export const DEFAULT_RULES: Rule[] = [
  { id: 'seed-tw', name: 'Twitter / X', pattern: 'twitter.com', category: 'entertainment', enabled: true, createdAt: 1 },
  { id: 'seed-x', name: 'x.com', pattern: 'x.com', category: 'entertainment', enabled: true, createdAt: 2 },
  { id: 'seed-bili-live', name: 'B站直播', pattern: 'live.bilibili.com', category: 'entertainment', enabled: true, createdAt: 3 },
  { id: 'seed-bili-video', name: 'B站视频', pattern: 'bilibili.com/video/*', category: 'entertainment', enabled: true, createdAt: 4 },
  { id: 'seed-bili', name: 'B站其余', pattern: 'bilibili.com', category: 'entertainment', enabled: true, createdAt: 5 },
  { id: 'seed-youtube', name: 'YouTube', pattern: 'youtube.com', category: 'entertainment', enabled: true, createdAt: 6 },
  { id: 'seed-twitch', name: 'Twitch', pattern: 'twitch.tv', category: 'entertainment', enabled: true, createdAt: 7 },
  { id: 'seed-coursera', name: 'Coursera', pattern: 'coursera.org', category: 'learning', enabled: true, createdAt: 8 },
  { id: 'seed-leetcode', name: 'LeetCode', pattern: 'leetcode.cn', category: 'learning', enabled: true, createdAt: 9 },
  { id: 'seed-github', name: 'GitHub', pattern: 'github.com', category: 'work', enabled: true, createdAt: 10 },
];

/** 模板包（v0.3 options 一键导入；按 pattern 去重后追加） */
export const TEMPLATE_PACKS: Array<{
  id: string;
  name: string;
  items: Array<{ name: string; pattern: string; category: string }>;
}> = [
  {
    id: 'social',
    name: '社交',
    items: [
      { name: 'Twitter / X', pattern: 'x.com', category: 'entertainment' },
      { name: 'Twitter 移动域', pattern: 'twitter.com', category: 'entertainment' },
      { name: 'Instagram', pattern: 'instagram.com', category: 'entertainment' },
      { name: '微博', pattern: 'weibo.com', category: 'entertainment' },
      { name: '小红书', pattern: 'xiaohongshu.com', category: 'entertainment' },
      { name: 'Reddit', pattern: 'reddit.com', category: 'entertainment' },
    ],
  },
  {
    id: 'video',
    name: '视频',
    items: [
      { name: 'B站', pattern: 'bilibili.com', category: 'entertainment' },
      { name: 'B站视频（便于改判/白名单）', pattern: 'bilibili.com/video/*', category: 'entertainment' },
      { name: 'YouTube', pattern: 'youtube.com', category: 'entertainment' },
      { name: '抖音', pattern: 'douyin.com', category: 'entertainment' },
    ],
  },
  {
    id: 'live',
    name: '直播',
    items: [
      { name: 'B站直播', pattern: 'live.bilibili.com', category: 'entertainment' },
      { name: 'Twitch', pattern: 'twitch.tv', category: 'entertainment' },
      { name: '斗鱼', pattern: 'douyu.com', category: 'entertainment' },
    ],
  },
  {
    id: 'learn',
    name: '学习',
    items: [
      { name: 'Coursera', pattern: 'coursera.org', category: 'learning' },
      { name: 'LeetCode', pattern: 'leetcode.cn', category: 'learning' },
      { name: 'MDN', pattern: 'developer.mozilla.org', category: 'learning' },
      { name: 'B站教育分区视频', pattern: 'bilibili.com/video/*', category: 'learning' },
    ],
  },
];
