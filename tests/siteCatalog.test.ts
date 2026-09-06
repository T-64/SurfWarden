import { describe, expect, it } from 'vitest';
import { lookupCatalog, normalizeHost, SITE_CATALOG, suggestForHost } from '../src/core/siteCatalog';

describe('normalizeHost', () => {
  it('去 www 前缀并转小写', () => {
    expect(normalizeHost('www.Twitter.com')).toBe('twitter.com');
    expect(normalizeHost('live.bilibili.com')).toBe('live.bilibili.com');
  });
});

describe('lookupCatalog', () => {
  it('精确命中', () => {
    expect(lookupCatalog('github.com')?.group).toBe('开发');
    expect(lookupCatalog('www.bilibili.com')?.name).toBe('哔哩哔哩'); // www 归一
  });

  it('后缀命中子域，且最长 host 优先', () => {
    expect(lookupCatalog('live.bilibili.com')?.group).toBe('直播'); // 长于 bilibili.com(视频)
    expect(lookupCatalog('mail.google.com')?.group).toBe('搜索'); // endsWith('google.com')
  });

  it('未收录返回 null', () => {
    expect(lookupCatalog('example.com')).toBeNull();
    expect(lookupCatalog('')).toBeNull();
  });

  it('twitch.tv 不会被 twitch.tv.example.com 伪造命中', () => {
    expect(lookupCatalog('twitch.tv.example.com')?.host).not.toBe('twitch.tv');
  });
});

describe('suggestForHost', () => {
  it('返回组/标签/类别与建议 pattern', () => {
    const s = suggestForHost('twitter.com');
    expect(s).toMatchObject({ group: '社交', category: 'entertainment', pattern: 'twitter.com' });
    expect(s?.tags.length).toBeGreaterThan(0);
  });

  it('未收录 → null（popup 不显示建议卡）', () => {
    expect(suggestForHost('example.com')).toBeNull();
  });
});

describe('目录数据卫生', () => {
  it('host 全部小写且无 www 前缀、无重复', () => {
    const hosts = SITE_CATALOG.map((e) => e.host);
    for (const h of hosts) {
      expect(h).toBe(h.toLowerCase());
      expect(h.startsWith('www.')).toBe(false);
    }
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('每条都有合法类别与组', () => {
    const validCats = new Set(['learning', 'work', 'entertainment', 'neutral']);
    for (const e of SITE_CATALOG) {
      expect(validCats.has(e.category)).toBe(true);
      expect(e.group.length).toBeGreaterThan(0);
      expect(e.name.length).toBeGreaterThan(0);
    }
  });
});
