import type { ClassifyResult, Rule } from './types';

/**
 * 规则匹配（纯函数）——语法与优先级见 docs/design/key-algorithms.md §2。
 *
 * v0.1 支持 exact / path / domain 三种形态；wildcard / regex 的 score 槽位
 * 已预留（v0.2 U1 补全语义）。解析失败的 pattern 静默跳过（写入 options 页后不会出现）。
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
  category: string;
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
    if (!r.enabled) continue;
    const parsed = parsePattern(r.pattern);
    if (!parsed) continue;
    out.push({ id: r.id, category: r.category, order: out.length, ...parsed });
  }
  return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

/** 首个命中生效；无命中返回 null（由调用方落默认类别）。非 http(s) 一律 null */
export function matchUrl(compiled: CompiledRule[], href: string): ClassifyResult | null {
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
      if (full === r.exactUrl) return { categoryId: r.category, ruleId: r.id };
      continue;
    }
    if (r.kind === 'regex') {
      if (r.regex!.test(href)) return { categoryId: r.category, ruleId: r.id };
      continue;
    }
    if (!hostMatches(host, r)) continue;
    if (r.kind === 'path' || r.kind === 'wildcard') {
      if (!u.pathname.toLowerCase().startsWith(r.pathPrefix ?? '/')) continue;
    }
    return { categoryId: r.category, ruleId: r.id };
  }
  return null;
}
