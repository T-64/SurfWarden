import { describe, expect, it } from 'vitest';
import { domainsByCategory, planBlockRules, stableId } from '../src/adapters/dnr';
import type { Rule } from '../src/core/types';

let seq = 0;
const rule = (pattern: string, category: string, enabled = true): Rule => ({
  id: `r${++seq}`,
  name: pattern,
  pattern,
  category,
  enabled,
  createdAt: seq,
});

describe('domainsByCategory（ADR-0008 域名提取）', () => {
  it('domain/path/wildcard 提取 host 段，禁用规则剔除，exact/regex 不参与', () => {
    const m = domainsByCategory([
      rule('twitter.com', 'entertainment'),
      rule('bilibili.com/video/*', 'learning'),
      rule('*.twitch.tv/*', 'entertainment'),
      rule('https://a.com/x', 'work'),
      rule('re:apex', 'entertainment'),
      rule('weibo.com', 'entertainment', false),
    ]);
    expect(m.get('entertainment')).toEqual(new Set(['twitter.com', 'twitch.tv']));
    expect(m.get('learning')).toEqual(new Set(['bilibili.com']));
    expect(m.has('work')).toBe(false);
  });
});

describe('stableId', () => {
  it('同 key 在空 used 集下稳定；批内重复注册换盐得到不同 id', () => {
    expect(stableId('k', new Set())).toBe(stableId('k', new Set()));
    const used = new Set<number>();
    const a = stableId('entertainment#twitter.com', used);
    const b = stableId('entertainment#twitter.com', used); // 同批重复注册（不应发生，防御性换盐）
    const c = stableId('entertainment#x.com', used);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(2 ** 31);
    expect(b).not.toBe(a);
    expect(c).not.toBe(a);
    expect(used.size).toBe(3);
  });

  it('碰撞时换盐重散列保证批内唯一', () => {
    const used = new Set<number>();
    const ids = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const id = stableId(`cat#domain${i}`, used);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });
});

describe('planBlockRules', () => {
  it('每类别 × 域名一条 main_frame 重定向规则，url 带域名根', () => {
    const blocked = new Map([['entertainment', new Set(['twitter.com', 'x.com'])]]);
    const rules = planBlockRules(blocked, {
      guideUrl: (catId, domain) =>
        `chrome-extension://abc/guide.html?cat=${catId}&url=${encodeURIComponent(`https://${domain}/`)}`,
    });
    expect(rules).toHaveLength(2);
    for (const r of rules) {
      expect(r.condition.resourceTypes).toEqual(['main_frame']);
      expect(r.action.type).toBe('redirect');
      expect(r.priority).toBe(1);
    }
    const urls = rules.map((r) => (r.action.redirect as { url: string }).url);
    expect(urls.some((u) => u.includes('url=https%3A%2F%2Ftwitter.com%2F'))).toBe(true);
    expect(urls.every((u) => u.startsWith('chrome-extension://abc/guide.html?cat=entertainment'))).toBe(true);
    const ids = new Set(rules.map((r) => r.id));
    expect(ids.size).toBe(2);
  });
});
