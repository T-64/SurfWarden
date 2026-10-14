import type { ChannelRule, GermanTarget, LastGerman, Rule, Settings } from '../core/types';
import { DEFAULT_CHANNELS, DEFAULT_RULES, DEFAULT_SETTINGS, DEFAULT_TARGETS } from '../shared/defaults';

/**
 * 配置（chrome.storage.local）。薄封装，无业务判断。
 * CONFIG_KEYS 变化 = 用户改了配置，SW 需要重载与重新对账；lastGerman 不在其中。
 */

const K = {
  settings: 'settings',
  rules: 'rules',
  channels: 'channels',
  targets: 'targets',
  lastGerman: 'lastGerman',
} as const;

export const CONFIG_KEYS: readonly string[] = [K.settings, K.rules, K.channels, K.targets];

async function get<T>(key: string, fallback: T): Promise<T> {
  const o = await chrome.storage.local.get(key);
  return (o[key] as T | undefined) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export const config = {
  async getSettings(): Promise<Settings> {
    const stored = await get<Partial<Settings>>(K.settings, {});
    return { ...DEFAULT_SETTINGS, ...stored };
  },
  getRules: () => get<Rule[]>(K.rules, DEFAULT_RULES),
  getChannels: () => get<ChannelRule[]>(K.channels, DEFAULT_CHANNELS),
  getTargets: () => get<GermanTarget[]>(K.targets, DEFAULT_TARGETS),
  getLastGerman: () => get<LastGerman | null>(K.lastGerman, null),

  saveSettings: (s: Settings) => set(K.settings, s),
  saveRules: (r: Rule[]) => set(K.rules, r),
  saveChannels: (c: ChannelRule[]) => set(K.channels, c),
  saveTargets: (t: GermanTarget[]) => set(K.targets, t),
  saveLastGerman: (g: LastGerman) => set(K.lastGerman, g),

  async ensureDefaults(): Promise<void> {
    const o = await chrome.storage.local.get([K.settings, K.rules, K.channels, K.targets]);
    const patch: Record<string, unknown> = {};
    if (o[K.settings] === undefined) patch[K.settings] = DEFAULT_SETTINGS;
    if (o[K.rules] === undefined) patch[K.rules] = DEFAULT_RULES;
    if (o[K.channels] === undefined) patch[K.channels] = DEFAULT_CHANNELS;
    if (o[K.targets] === undefined) patch[K.targets] = DEFAULT_TARGETS;
    if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
  },

  onConfigChange(cb: () => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some((k) => CONFIG_KEYS.includes(k))) cb();
    });
  },
};
