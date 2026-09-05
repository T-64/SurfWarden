import { describe, expect, it } from 'vitest';
import { compileRules, matchUrl, parsePattern } from '../src/core/urlMatch';
import type { Rule } from '../src/core/types';

let seq = 0;
function rule(pattern: string, category = 'entertainment', overrides: Partial<Rule> = {}): Rule {
  return {
    id: `r${++seq}`,
    name: pattern,
    pattern,
    category,
    enabled: true,
    createdAt: seq,
    ...overrides,
  };
}

describe('parsePattern 形态识别', () => {
  it('识别 exact / domain / path / wildcard / regex', () => {
    expect(parsePattern('https://a.com/x?y=1')?.kind).toBe('exact');
    expect(parsePattern('bilibili.com')?.kind).toBe('domain');
    expect(parsePattern('bilibili.com/video/*')?.kind).toBe('path');
    expect(parsePattern('*.twitch.tv/*')?.kind).toBe('wildcard');
    expect(parsePattern('re:apex.*直播')?.kind).toBe('regex');
  });

  it('空串/裸星号/坏正则/非法 URL 返回 null', () => {
    expect(parsePattern('')).toBeNull();
    expect(parsePattern('   ')).toBeNull();
    expect(parsePattern('*')).toBeNull();
    expect(parsePattern('re:[unclosed')).toBeNull();
    expect(parsePattern('https://a b.com/')).toBeNull();
  });

  it('path 前缀归一化：补斜杠、去尾部星号', () => {
    const p = parsePattern('a.com/video/*');
    expect(p?.pathPrefix).toBe('/video/');
    const q = parsePattern('a.com/live');
    expect(q?.pathPrefix).toBe('/live/');
  });
});

describe('matchUrl', () => {
  const compiled = compileRules([
    rule('twitter.com'),
    rule('live.bilibili.com', 'entertainment'),
    rule('bilibili.com/video/*', 'learning'),
    rule('coursera.org', 'learning'),
  ]);

  const match = (url: string) => matchUrl(compiled, url)?.categoryId ?? null;

  it('domain：命中域名及全部子域', () => {
    expect(match('https://twitter.com/home')).toBe('entertainment');
    expect(match('https://www.twitter.com/home')).toBe('entertainment');
  });

  it('path：更具体的规则赢——B 站视频记学习、直播记娱乐（PRODUCT.md 核心场景）', () => {
    expect(match('https://www.bilibili.com/video/BV1xx?p=1')).toBe('learning');
    expect(match('https://live.bilibili.com/12345')).toBe('entertainment');
    expect(match('https://www.bilibili.com/')).toBeNull();
  });

  it('非 http(s) 一律不匹配', () => {
    expect(match('chrome://extensions')).toBeNull();
    expect(match('chrome-extension://abc/popup.html')).toBeNull();
    expect(match('ftp://a.com/x')).toBeNull();
    expect(match('not a url')).toBeNull();
  });

  it('hash 不影响 exact 匹配；大小写不敏感', () => {
    const c = compileRules([rule('https://a.com/watch?v=1', 'learning')]);
    expect(matchUrl(c, 'https://A.com/watch?v=1#comments')?.categoryId).toBe('learning');
  });

  it('无命中返回 null（默认类别由调用方决定）', () => {
    expect(match('https://example.org/')).toBeNull();
  });
});

describe('优先级：specificity 降序，同分按创建先后（ADR 设计 §2.2）', () => {
  it('path(8) > domain(4)，与规则顺序无关', () => {
    const c = compileRules([
      rule('bilibili.com', 'entertainment'), // 先创建，分低
      rule('bilibili.com/video/*', 'learning'), // 后创建，分高
    ]);
    expect(matchUrl(c, 'https://bilibili.com/video/BV1')?.categoryId).toBe('learning');
    expect(matchUrl(c, 'https://bilibili.com/')?.categoryId).toBe('entertainment');
  });

  it('exact(10) 最高；同分（同形态）按 createdAt 升序', () => {
    const c = compileRules([
      rule('bilibili.com/video/*', 'a'),
      rule('bilibili.com/video/*', 'b'), // 同分，后创建，不赢
      rule('https://bilibili.com/video/BVexact', 'exact-cat'),
    ]);
    expect(matchUrl(c, 'https://bilibili.com/video/BVexact')?.categoryId).toBe('exact-cat');
    expect(matchUrl(c, 'https://bilibili.com/video/BVother')?.categoryId).toBe('a');
  });

  it('禁用规则被剔除；非法 pattern 不参与', () => {
    const c = compileRules([
      rule('twitter.com', 'entertainment', { enabled: false }),
      rule('bad ** pattern', 'entertainment'),
      rule('github.com', 'work'),
    ]);
    expect(matchUrl(c, 'https://twitter.com/')).toBeNull();
    expect(matchUrl(c, 'https://github.com/')?.categoryId).toBe('work');
  });
});

describe('wildcard / regex 槽位（v0.2 完成语义前的基本行为）', () => {
  it('wildcard：host 侧接受子域，path 侧按前缀', () => {
    const c = compileRules([rule('*.twitch.tv/*')]);
    expect(matchUrl(c, 'https://www.twitch.tv/apex')?.categoryId).toBe('entertainment');
    expect(matchUrl(c, 'https://twitch.tv/')?.categoryId).toBe('entertainment');
    expect(matchUrl(c, 'https://twitch.tv.example.com/')).toBeNull(); // 后缀拼接伪造的域不命中
  });

  it('regex：对完整 href 做大小写不敏感匹配', () => {
    const c = compileRules([rule('re:apex|predator', 'entertainment')]);
    expect(matchUrl(c, 'https://example.com/APEX-highlights')?.categoryId).toBe('entertainment');
    expect(matchUrl(c, 'https://example.com/valorant')).toBeNull();
  });
});
