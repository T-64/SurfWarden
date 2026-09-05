import type { Rule } from '../core/types';
import { parsePattern } from '../core/urlMatch';

/**
 * declarativeNetRequest 动态规则封装（ADR-0008）。
 * 纯函数部分（域名提取 / 规则计划）可单测；chrome 调用只有 applyRules 一层。
 */

/** 类别 → 封锁域名集合（enabled 规则中 domain/path/wildcard 形态的 host 段） */
export function domainsByCategory(rules: Rule[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rules) {
    if (!r.enabled) continue;
    const parsed = parsePattern(r.pattern);
    if (!parsed?.host) continue; // exact/regex 不参与域名封锁（ADR-0008）
    let set = out.get(r.category);
    if (!set) {
      set = new Set();
      out.set(r.category, set);
    }
    set.add(parsed.host);
  }
  return out;
}

/** 稳定 31 位正整数 id；同批碰撞时换盐重散列（确定性） */
export function stableId(key: string, used: Set<number>): number {
  let salt = 0;
  for (;;) {
    let h = 0;
    const s = salt === 0 ? key : `${key}#${salt}`;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    const id = (Math.abs(h) % 1_000_000_000) + 1;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
    salt++;
  }
}

export interface PlanOptions {
  /** 引导页完整 URL 构造器（注入以便单测） */
  guideUrl(catId: string, domain: string): string;
}

/** 期望规则全集：每个封锁类别 × 域名一条（ADR-0008） */
export function planBlockRules(
  blocked: Map<string, Set<string>>,
  opts: PlanOptions,
): chrome.declarativeNetRequest.Rule[] {
  const used = new Set<number>();
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  for (const [catId, domains] of blocked) {
    for (const domain of domains) {
      rules.push({
        id: stableId(`${catId}#${domain}`, used),
        priority: 1,
        condition: {
          requestDomains: [domain],
          resourceTypes: ['main_frame'],
        },
        action: {
          type: 'redirect',
          redirect: { url: opts.guideUrl(catId, domain) },
        },
      });
    }
  }
  return rules;
}

/** 全量 diff 重算（单次原子调用；本插件独占动态规则空间） */
export async function applyBlockRules(
  desired: chrome.declarativeNetRequest.Rule[],
): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: desired,
  });
}
