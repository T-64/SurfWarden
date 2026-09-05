/**
 * 领域类型——唯一权威定义，与 docs/design/data-model.md 对应。
 * 本文件属于 core 层：禁止 import chrome/* 或任何适配器。
 */

// ===== 配置类（chrome.storage.local） =====

export type CategoryId = string;
export type SupervisionAction = 'track' | 'nudge' | 'budget' | 'hard';

export interface Category {
  id: CategoryId;
  name: string;
  color: string;
  /** 每日预算（分钟）；undefined = 不设限（正向类） */
  budgetMin?: number;
  action: SupervisionAction;
}

export interface Rule {
  id: string;
  name: string;
  pattern: string;
  category: CategoryId;
  enabled: boolean;
  /** 同 specificity 打平时按创建先后 */
  createdAt: number;
}

export interface StudyTarget {
  id: string;
  name: string;
  url: string;
}

export interface Settings {
  /** 一天结束时刻（本地小时，默认 0；凌晨党可设 4） */
  dayCutoffHour: number;
  /** 心跳丢失宽限（秒） */
  idleGraceSec: number;
  /** idle 判定阈值（秒，15–300） */
  idleThresholdSec: number;
  /** 豁免次数/天 */
  exemptPerDay: number;
  /** 单次豁免时长（分钟） */
  exemptMinutes: number;
  /** 暂停监督截止时间戳（ms），undefined = 未暂停 */
  pauseUntil?: number;
}

export interface ClassifyResult {
  categoryId: CategoryId;
  ruleId?: string;
}

// ===== 计时状态机 =====

export type IdleState = 'active' | 'idle' | 'locked';

export interface TabInfo {
  tabId: number;
  url: string;
  title?: string;
  incognito: boolean;
}

/**
 * 归一化事件（adapter 负责把 chrome.* 原始事件补全 URL/标题后归一化）。
 * 语义见 docs/design/key-algorithms.md §1。
 */
export type TrackerEvent =
  | ({ type: 'tab-activated'; windowId: number; at: number } & TabInfo)
  | ({ type: 'tab-updated'; windowId: number; at: number } & TabInfo)
  | { type: 'tab-removed'; tabId: number; at: number }
  /** windowId = -1 表示所有窗口失焦 */
  | { type: 'window-focus'; windowId: number; at: number }
  | { type: 'idle-changed'; state: IdleState; at: number }
  | { type: 'heartbeat'; at: number }
  /** 浏览器启动；残留段按水位截断入库 */
  | { type: 'startup'; at: number }
  /** SW 冷启动全量对账 */
  | {
      type: 'sync';
      at: number;
      focusedWindowId: number | null;
      idleState: IdleState;
      tabs: Array<{ windowId: number } & TabInfo>;
    };

export type EndReason = 'event' | 'idle' | 'blur' | 'cap';

export interface ActiveSegment {
  windowId: number;
  tabId: number;
  url: string;
  host: string;
  title?: string;
  incognito: boolean;
  categoryId: CategoryId;
  ruleId?: string;
  startedAt: number;
}

/** 一次连续停留的闭合段；跨 dayCutoff 的段会被拆成多条（date 各归其日） */
export interface ClosedSegment {
  date: string;
  start: number;
  end: number;
  host: string;
  url: string;
  title?: string;
  categoryId: CategoryId;
  ruleId?: string;
  incognito: boolean;
  endReason: EndReason;
}

export interface TrackerState {
  focusedWindowId: number | null;
  /** windowId -> 该窗口当前 active tab */
  activeTabs: Record<number, TabInfo>;
  current: ActiveSegment | null;
  /** 活动水位：最后一次有正证据的用户活动时刻 */
  lastActiveAt: number;
  /** 最后已知的系统 idle 状态（开段前置条件） */
  idleState: IdleState;
}

export interface TrackerDeps {
  idleGraceSec: number;
  dayCutoffHour: number;
  /** 返回 null 表示 URL 不可追踪（非 http(s) 等），不产生段 */
  classify(url: string): ClassifyResult | null;
}

export interface StepResult {
  state: TrackerState;
  closed: ClosedSegment[];
}

// ===== 数据类（IndexedDB，docs/design/data-model.md §2） =====

/** sessions 表一行 */
export interface SessionRow extends ClosedSegment {
  /** 自增主键 */
  id?: number;
}

/** usage_daily 表一行，复合主键 [date+categoryId+host] */
export interface UsageRow {
  date: string;
  categoryId: CategoryId;
  host: string;
  seconds: number;
  visits: number;
}

/** exempts 表一行，主键 date */
export interface ExemptRow {
  date: string;
  count: number;
}
