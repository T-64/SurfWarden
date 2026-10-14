import type { CategoryId, ChannelRule, GermanTarget, Rule, Settings } from '../core/types';

/** 默认配置（首次安装写入；之后以 storage 为准，缺失字段用这里补齐）。 */

/**
 * 类别色：dataviz 校验（暗面 #131518，--pairs all）通过——德语/学业/娱乐任意两两
 * CVD ΔE ≥ 10.3、明度带 0.48–0.67、对比 ≥ 3:1。避开红绿（原 #3ddc84/#ff5c5c 氘盲 ΔE 2.1）。
 * 「其他」是刻意压暗的背景桶（对比 < 3:1），靠图例 + 悬停 + 表格补足。
 */
export const CATEGORY_META: Record<CategoryId, { name: string; color: string }> = {
  german: { name: '德语', color: '#1fa67a' },
  study: { name: '学业', color: '#4f8de0' },
  drift: { name: '娱乐', color: '#d9732f' },
  other: { name: '其他', color: '#4b5058' },
};

export const DEFAULT_SETTINGS: Settings = {
  schedule: { windDown: 22 * 60 + 30, bedtime: 23 * 60, wake: 7 * 60 + 30 },
  germanGoalMin: 45,
  driftCapMin: 60,
  passOptionsMin: [5, 10, 20],
  curfewAllow: {
    categories: ['german', 'study'],
    hosts: [
      'outlook.live.com',
      'outlook.office.com',
      'mail.google.com',
      'mail.qq.com',
      'bahn.de',
      'vvs.de',
      'deepl.com',
      'translate.google.com',
    ],
  },
  curfewExtMin: 10,
  curfewExtPerNight: 1,
  idleThresholdSec: 120,
  idleGraceSec: 60,
  dayCutoffHour: 5,
};

const seed = (patterns: string[], category: CategoryId, offset: number): Rule[] =>
  patterns.map((pattern, i) => ({ id: `seed-${category}-${i}`, pattern, category, createdAt: offset + i }));

export const DEFAULT_RULES: Rule[] = [
  ...seed(
    [
      'learngerman.dw.com',
      'dw.com/de/*',
      'languagetransfer.org',
      'ankiweb.net',
      'dict.cc',
      'dict.leo.org',
      'dwds.de',
      'duden.de',
      'verbformen.de',
      'verbformen.com',
      'tagesschau.de',
      'easygerman.org',
      'goethe.de',
    ],
    'german',
    100,
  ),
  ...seed(
    [
      'uni-stuttgart.de',
      'github.com',
      'stackoverflow.com',
      'developer.mozilla.org',
      'arxiv.org',
      'scholar.google.com',
      'overleaf.com',
      'claude.ai',
      'chatgpt.com',
    ],
    'study',
    200,
  ),
  ...seed(
    [
      'bilibili.com',
      'x.com',
      'twitter.com',
      'youtube.com',
      'twitch.tv',
      'douyu.com',
      'huya.com',
      'weibo.com',
      'xiaohongshu.com',
      'douyin.com',
      'tiktok.com',
      'instagram.com',
      'reddit.com',
      'zhihu.com',
    ],
    'drift',
    300,
  ),
];

/** 已在真实页面核实（2026-10-14）：DEPedia 在 B 站搬运了 Nicos Weg 全集 */
export const DEFAULT_CHANNELS: ChannelRule[] = [
  { platform: 'bilibili', id: '279118193', name: '德国百科DEPedia', category: 'german' },
  { platform: 'youtube', id: '@EasyGerman', name: 'Easy German', category: 'german' },
];

export const DEFAULT_TARGETS: GermanTarget[] = [
  { id: 't-nicos', name: 'Nicos Weg', url: 'https://learngerman.dw.com/de/nicos-weg/c-36519687' },
  { id: 't-anki', name: 'AnkiWeb 复习', url: 'https://ankiweb.net/decks' },
];
