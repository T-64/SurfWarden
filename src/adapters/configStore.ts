import type { Category, Rule, Settings, StudyTarget } from '../core/types';
import { DEFAULT_CATEGORIES, DEFAULT_RULES, DEFAULT_SETTINGS } from '../shared/defaults';

/**
 * 配置读写（chrome.storage.local）。薄封装：无业务判断（dev-process §2）。
 * key：rules / categories / settings / studyTargets
 */

const K = {
  rules: 'rules',
  categories: 'categories',
  settings: 'settings',
  studyTargets: 'studyTargets',
} as const;

async function get<T>(key: string, fallback: T): Promise<T> {
  const o = await chrome.storage.local.get(key);
  return (o[key] as T | undefined) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export const configStore = {
  getRules: (): Promise<Rule[]> => get<Rule[]>(K.rules, DEFAULT_RULES),
  getCategories: (): Promise<Category[]> => get<Category[]>(K.categories, DEFAULT_CATEGORIES),
  getSettings: (): Promise<Settings> => get<Settings>(K.settings, DEFAULT_SETTINGS),
  getStudyTargets: (): Promise<StudyTarget[]> => get<StudyTarget[]>(K.studyTargets, []),

  saveRules: (rules: Rule[]) => set(K.rules, rules),
  saveCategories: (cats: Category[]) => set(K.categories, cats),
  saveSettings: (s: Settings) => set(K.settings, s),
  saveStudyTargets: (t: StudyTarget[]) => set(K.studyTargets, t),

  /** 首次安装写入默认值；已存在的键不动 */
  async ensureDefaults(): Promise<void> {
    const o = await chrome.storage.local.get([K.rules, K.categories, K.settings]);
    const patch: Record<string, unknown> = {};
    if (o[K.rules] === undefined) patch[K.rules] = DEFAULT_RULES;
    if (o[K.categories] === undefined) patch[K.categories] = DEFAULT_CATEGORIES;
    if (o[K.settings] === undefined) patch[K.settings] = DEFAULT_SETTINGS;
    if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
  },

  /** 配置变化（options 页保存等）时刷新内存缓存用 */
  onLocalChange(cb: () => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') cb();
    });
  },
};
