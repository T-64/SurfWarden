import type { CategoryId, Rule } from './types';

/**
 * 网址规则匹配（纯函数）。语法：
 *   twitter.com            domain：该域及全部子域
 *   bilibili.com/video/*   path：域名 + 路径前缀
 *   *.twitch.tv/*          wildcard：任意子域 + 路径前缀
 *   https://a.com/x        exact：完整 URL（忽略 #hash）
 *   re:^https://…          regex：大小写不敏感
 * 优先级 exact > path > regex > domain > wildcard，同分按创建先后。非法 pattern 静默跳过
 * （options 页保存前用 parsePattern 校验）。
 */

export type PatternKind = 'exact' | 'regex' | 'path' | 'wildcard' | 'domain';

const SCORE: Record<PatternKind, number> = {
  exact: 10,
  path: 8,
  regex: 6,
  domain: 4,
  wildcard: 2,
};

export interface CompiledRule {
  id: string;
  category: CategoryId;
  kind: PatternKind;
  score: number;
  /** 编译时的创建序，同分打破平局 */
  order: number;
  exactUrl?: string;
  regex?: RegExp;
  host?: string;
  /** host 侧是否接受任意子域（wildcard 形态 `*.a.tv`） */
  anySubdomain?: boolean;
  pathPrefix?: string;
}

function normalizeExactUrl(u: URL): string {
  u.hash = '';
  return u.toString();
}

/** 解析单条 pattern；非法返回 null */
export function parsePattern(pattern: string): Omit<CompiledRule, 'id' | 'category' | 'order'> | null {
  const p = pattern.trim();
  if (!p) return null;

  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      u.hash = '';
      return { kind: 'exact', score: SCORE.exact, exactUrl: u.toString() };
    } catch {
      return null;
    }
  }

  if (p.startsWith('re:')) {
    try {
      return { kind: 'regex', score: SCORE.regex, regex: new RegExp(p.slice(3), 'i') };
    } catch {
      return null;
    }
  }

  const slash = p.indexOf('/');
  const hostPart = (slash === -1 ? p : p.slice(0, slash)).toLowerCase();
  const pathPart = slash === -1 ? '' : p.slice(slash + 1);
  if (!hostPart || hostPart === '*') return null;

  if (hostPart.startsWith('*.')) {
    const host = hostPart.slice(2);
    if (!host) return null;
    return {
      kind: 'wildcard',
      score: SCORE.wildcard,
      host,
      anySubdomain: true,
      pathPrefix: normalizePathPrefix(pathPart),
    };
  }

  if (pathPart) {
    return { kind: 'path', score: SCORE.path, host: hostPart, pathPrefix: normalizePathPrefix(pathPart) };
  }
  return { kind: 'domain', score: SCORE.domain, host: hostPart };
}

/** 'video/*' -> '/video/'；'*' 或 '' -> '/'；无尾部 * 时仍按前缀匹配 */
function normalizePathPrefix(pathPart: string): string {
  let s = pathPart.replace(/\*+$/, '');
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s = s + '/';
  return s;
}

function hostMatches(host: string, rule: CompiledRule): boolean {
  const r = rule.host!;
  return host === r || host.endsWith('.' + r) || (rule.anySubdomain === true && host === r);
}

/** 编译规则集：禁用/非法规则剔除，按 (score desc, createdAt asc) 排序 */
export function compileRules(rules: Rule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  const sorted = [...rules].sort((a, b) => a.createdAt - b.createdAt);
  for (const r of sorted) {
    const parsed = parsePattern(r.pattern);
    if (!parsed) continue;
    out.push({ id: r.id, category: r.category, order: out.length, ...parsed });
  }
  return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

export interface RuleHit {
  category: CategoryId;
  ruleId: string;
}

/** 首个命中生效；无命中或非 http(s) 返回 null */
export function matchUrl(compiled: CompiledRule[], href: string): RuleHit | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const full = normalizeExactUrl(u);

  for (const r of compiled) {
    if (r.kind === 'exact') {
      if (full === r.exactUrl) return { category: r.category, ruleId: r.id };
      continue;
    }
    if (r.kind === 'regex') {
      if (r.regex!.test(href)) return { category: r.category, ruleId: r.id };
      continue;
    }
    if (!hostMatches(host, r)) continue;
    if (r.kind === 'path' || r.kind === 'wildcard') {
      if (!u.pathname.toLowerCase().startsWith(r.pathPrefix ?? '/')) continue;
    }
    return { category: r.category, ruleId: r.id };
  }
  return null;
}
