import type { ChannelRule, ChannelSignal, ClassifyResult, Rule } from './types';
import { compileRules, matchUrl } from './urlMatch';

/**
 * 分类（纯函数）：频道规则 > 网址规则 > other；非 http(s) 返回 null（不追踪）。
 * 手动改判（override）由 tracker 在调用前处理。
 */

export type Classifier = (url: string, channel?: ChannelSignal) => ClassifyResult | null;

export function isTrackable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function makeClassifier(rules: Rule[], channels: ChannelRule[]): Classifier {
  const compiled = compileRules(rules);
  const byChannel = new Map(channels.map((c) => [channelKey(c), c.category]));
  return (url, channel) => {
    if (!isTrackable(url)) return null;
    if (channel) {
      const cat = byChannel.get(channelKey(channel));
      if (cat) return { category: cat, source: 'channel' };
    }
    const hit = matchUrl(compiled, url);
    if (hit) return { category: hit.category, source: 'rule' };
    return { category: 'other', source: 'default' };
  };
}

export function channelKey(c: { platform: string; id: string }): string {
  return `${c.platform}:${c.id}`;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

/**
 * 站点键（eTLD+1 的近似）：www.bilibili.com / live.bilibili.com → bilibili.com；
 * news.bbc.co.uk → bbc.co.uk。通行证按站点键发放。
 */
export function siteKey(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  const n = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-n).join('.');
}

/** host 是否命中白名单条目（条目为域名，含子域） */
export function hostInList(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((raw) => {
    const d = raw.trim().toLowerCase().replace(/^www\./, '');
    return d !== '' && (h === d || h.endsWith('.' + d));
  });
}
