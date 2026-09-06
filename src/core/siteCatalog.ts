import type { CategoryId } from './types';

/**
 * 内置站点目录（ADR-0011）：常用站的分组/标签/建议类别先验。
 * 纯静态数据 + 纯函数匹配，无 AI 无网络。优先级：显式规则 > 目录建议 > 默认类别。
 */

export interface CatalogEntry {
  /** 匹配用 host（不含 www. 前缀；后缀匹配覆盖子域） */
  host: string;
  name: string;
  group: string;
  tags: string[];
  category: CategoryId;
}

export const SITE_CATALOG: CatalogEntry[] = [
  // 社交
  { host: 'twitter.com', name: 'Twitter / X', group: '社交', tags: ['国际', '文字'], category: 'entertainment' },
  { host: 'x.com', name: 'X (Twitter)', group: '社交', tags: ['国际'], category: 'entertainment' },
  { host: 'instagram.com', name: 'Instagram', group: '社交', tags: ['国际', '图片'], category: 'entertainment' },
  { host: 'facebook.com', name: 'Facebook', group: '社交', tags: ['国际'], category: 'entertainment' },
  { host: 'reddit.com', name: 'Reddit', group: '社交', tags: ['国际', '社区'], category: 'entertainment' },
  { host: 'threads.net', name: 'Threads', group: '社交', tags: ['国际'], category: 'entertainment' },
  { host: 'weibo.com', name: '微博', group: '社交', tags: ['国内'], category: 'entertainment' },
  { host: 'xiaohongshu.com', name: '小红书', group: '社交', tags: ['国内'], category: 'entertainment' },
  { host: 'zhihu.com', name: '知乎', group: '社交', tags: ['国内', '问答'], category: 'entertainment' },
  { host: 'tieba.baidu.com', name: '百度贴吧', group: '社交', tags: ['国内'], category: 'entertainment' },
  { host: 'discord.com', name: 'Discord', group: '社交', tags: ['国际', '聊天'], category: 'entertainment' },
  { host: 't.me', name: 'Telegram Web', group: '社交', tags: ['国际', '聊天'], category: 'entertainment' },
  // 视频
  { host: 'bilibili.com', name: '哔哩哔哩', group: '视频', tags: ['国内'], category: 'entertainment' },
  { host: 'youtube.com', name: 'YouTube', group: '视频', tags: ['国际'], category: 'entertainment' },
  { host: 'douyin.com', name: '抖音', group: '视频', tags: ['国内', '短视频'], category: 'entertainment' },
  { host: 'ixigua.com', name: '西瓜视频', group: '视频', tags: ['国内'], category: 'entertainment' },
  { host: 'kuaishou.com', name: '快手', group: '视频', tags: ['国内', '短视频'], category: 'entertainment' },
  { host: 'netflix.com', name: 'Netflix', group: '视频', tags: ['国际', '长视频'], category: 'entertainment' },
  { host: 'iqiyi.com', name: '爱奇艺', group: '视频', tags: ['国内', '长视频'], category: 'entertainment' },
  { host: 'youku.com', name: '优酷', group: '视频', tags: ['国内', '长视频'], category: 'entertainment' },
  { host: 'v.qq.com', name: '腾讯视频', group: '视频', tags: ['国内', '长视频'], category: 'entertainment' },
  // 直播
  { host: 'live.bilibili.com', name: 'B站直播', group: '直播', tags: ['国内'], category: 'entertainment' },
  { host: 'twitch.tv', name: 'Twitch', group: '直播', tags: ['国际', '游戏'], category: 'entertainment' },
  { host: 'douyu.com', name: '斗鱼', group: '直播', tags: ['国内', '游戏'], category: 'entertainment' },
  { host: 'huya.com', name: '虎牙', group: '直播', tags: ['国内', '游戏'], category: 'entertainment' },
  // 开发
  { host: 'github.com', name: 'GitHub', group: '开发', tags: ['国际', '代码'], category: 'work' },
  { host: 'gitlab.com', name: 'GitLab', group: '开发', tags: ['国际', '代码'], category: 'work' },
  { host: 'stackoverflow.com', name: 'Stack Overflow', group: '开发', tags: ['国际', '问答'], category: 'work' },
  { host: 'npmjs.com', name: 'npm', group: '开发', tags: ['国际', '包管理'], category: 'work' },
  { host: 'juejin.cn', name: '掘金', group: '开发', tags: ['国内', '社区'], category: 'work' },
  { host: 'vercel.com', name: 'Vercel', group: '开发', tags: ['国际', '部署'], category: 'work' },
  // 学习
  { host: 'developer.mozilla.org', name: 'MDN', group: '学习', tags: ['文档'], category: 'learning' },
  { host: 'leetcode.cn', name: '力扣', group: '学习', tags: ['国内', '算法'], category: 'learning' },
  { host: 'leetcode.com', name: 'LeetCode', group: '学习', tags: ['国际', '算法'], category: 'learning' },
  { host: 'coursera.org', name: 'Coursera', group: '学习', tags: ['课程'], category: 'learning' },
  { host: 'duolingo.com', name: '多邻国', group: '学习', tags: ['语言'], category: 'learning' },
  { host: 'khanacademy.org', name: '可汗学院', group: '学习', tags: ['课程'], category: 'learning' },
  { host: 'wikipedia.org', name: '维基百科', group: '学习', tags: ['百科'], category: 'learning' },
  { host: 'edu.bilibili.com', name: 'B站课堂', group: '学习', tags: ['国内', '课程'], category: 'learning' },
  // 新闻
  { host: 'news.ycombinator.com', name: 'Hacker News', group: '新闻', tags: ['国际', '科技'], category: 'neutral' },
  { host: '36kr.com', name: '36氪', group: '新闻', tags: ['国内', '科技'], category: 'neutral' },
  { host: 'techcrunch.com', name: 'TechCrunch', group: '新闻', tags: ['国际', '科技'], category: 'neutral' },
  { host: 'bbc.com', name: 'BBC', group: '新闻', tags: ['国际'], category: 'neutral' },
  { host: 'thepaper.cn', name: '澎湃新闻', group: '新闻', tags: ['国内'], category: 'neutral' },
  // 购物
  { host: 'taobao.com', name: '淘宝', group: '购物', tags: ['国内'], category: 'neutral' },
  { host: 'jd.com', name: '京东', group: '购物', tags: ['国内'], category: 'neutral' },
  { host: 'tmall.com', name: '天猫', group: '购物', tags: ['国内'], category: 'neutral' },
  { host: 'pinduoduo.com', name: '拼多多', group: '购物', tags: ['国内'], category: 'neutral' },
  { host: 'amazon.com', name: 'Amazon', group: '购物', tags: ['国际'], category: 'neutral' },
  // 搜索与工具
  { host: 'google.com', name: 'Google', group: '搜索', tags: ['国际'], category: 'neutral' },
  { host: 'bing.com', name: 'Bing', group: '搜索', tags: ['国际'], category: 'neutral' },
  { host: 'baidu.com', name: '百度', group: '搜索', tags: ['国内'], category: 'neutral' },
  { host: 'duckduckgo.com', name: 'DuckDuckGo', group: '搜索', tags: ['国际'], category: 'neutral' },
  // 办公
  { host: 'notion.so', name: 'Notion', group: '办公', tags: ['文档'], category: 'work' },
  { host: 'docs.google.com', name: 'Google Docs', group: '办公', tags: ['国际', '文档'], category: 'work' },
  { host: 'slack.com', name: 'Slack', group: '办公', tags: ['国际', '协作'], category: 'work' },
  { host: 'zoom.us', name: 'Zoom', group: '办公', tags: ['国际', '会议'], category: 'work' },
  { host: 'feishu.cn', name: '飞书', group: '办公', tags: ['国内', '协作'], category: 'work' },
  { host: 'dingtalk.com', name: '钉钉', group: '办公', tags: ['国内', '协作'], category: 'work' },
  // 音乐
  { host: 'spotify.com', name: 'Spotify', group: '音乐', tags: ['国际'], category: 'entertainment' },
  { host: 'music.163.com', name: '网易云音乐', group: '音乐', tags: ['国内'], category: 'entertainment' },
  { host: 'y.qq.com', name: 'QQ音乐', group: '音乐', tags: ['国内'], category: 'entertainment' },
  // 游戏
  { host: 'store.steampowered.com', name: 'Steam', group: '游戏', tags: ['国际', '商店'], category: 'entertainment' },
  { host: 'epicgames.com', name: 'Epic Games', group: '游戏', tags: ['国际'], category: 'entertainment' },
];

/** 归一化 host：去 www. 前缀、转小写 */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** 目录匹配：精确或后缀；多命中时取最长 host（live.bilibili.com 优先于 bilibili.com） */
export function lookupCatalog(host: string): CatalogEntry | null {
  const h = normalizeHost(host);
  if (!h) return null;
  let best: CatalogEntry | null = null;
  for (const e of SITE_CATALOG) {
    if (h === e.host || h.endsWith('.' + e.host)) {
      if (!best || e.host.length > best.host.length) best = e;
    }
  }
  return best;
}

export interface SiteSuggestion {
  name: string;
  group: string;
  tags: string[];
  category: CategoryId;
  /** 建议生成的规则 pattern（域名级） */
  pattern: string;
}

/** 未分类 host 的建议（ADR-0011 建议采纳流的数据源） */
export function suggestForHost(host: string): SiteSuggestion | null {
  const hit = lookupCatalog(host);
  if (!hit) return null;
  return {
    name: hit.name,
    group: hit.group,
    tags: hit.tags,
    category: hit.category,
    pattern: hit.host,
  };
}
