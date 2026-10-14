import type { CategoryId, ChannelRule, GermanTarget, Rule, Settings } from '../core/types';

/** 默认配置（首次安装写入；之后以 storage 为准，缺失字段用这里补齐）。 */

/**
 * 类别外观。color 是 CSS 变量，随「纸与夜」两种情绪切换（theme.css）；三个彩色类别
 * 经 dataviz 校验（任意两两、含色盲 ΔE ≥ 9），私密用斜线纹理而非颜色（不与任何类别撞色，
 * 也更低调），其他为退后的灰。
 */
export const CATEGORY_META: Record<CategoryId, { name: string; color: string }> = {
  german: { name: '德语', color: 'var(--c-german)' },
  study: { name: '学业', color: 'var(--c-study)' },
  drift: { name: '娱乐', color: 'var(--c-drift)' },
  private: { name: '私密', color: 'var(--c-private)' },
  other: { name: '其他', color: 'var(--c-other)' },
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
  privateCooldownSec: 180,
  privatePassMin: 20,
  privatePerDay: 1,
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
  ...seed(
    [
      'pornhub.com',
      'xvideos.com',
      'xnxx.com',
      'xhamster.com',
      'redtube.com',
      'youporn.com',
      'spankbang.com',
      'eporner.com',
      'onlyfans.com',
      'chaturbate.com',
      'stripchat.com',
      'missav.com',
      'missav.ws',
      'jable.tv',
      '91porn.com',
      'javdb.com',
      'javlibrary.com',
      'hanime.tv',
      'nhentai.net',
      'e-hentai.org',
      'rule34.xxx',
    ],
    'private',
    400,
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
