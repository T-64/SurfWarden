/**
 * 领域类型——唯一权威定义，对应 docs/design/architecture.md §6。
 * core 层：禁止 import chrome/* 或任何适配器。
 */

// ===== 类别与分类 =====

export const CATEGORY_IDS = ['german', 'study', 'drift', 'other'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export function isCategoryId(x: unknown): x is CategoryId {
  return typeof x === 'string' && (CATEGORY_IDS as readonly string[]).includes(x);
}

export interface Rule {
  id: string;
  pattern: string;
  category: CategoryId;
  name?: string;
  /** 同等具体度时按创建先后 */
  createdAt: number;
}

export type Platform = 'bilibili' | 'youtube';

/** 页面信号：视频页的 UP 主 / 频道 */
export interface ChannelSignal {
  platform: Platform;
  /** B 站 mid / YouTube @handle */
  id: string;
  name: string;
}

export interface ChannelRule extends ChannelSignal {
  category: CategoryId;
}

export type ClassifySource = 'manual' | 'channel' | 'rule' | 'default';

export interface ClassifyResult {
  category: CategoryId;
  source: ClassifySource;
}

// ===== 配置 =====

/** 一天中的分钟数 0–1439 */
export type MinuteOfDay = number;

export interface Schedule {
  windDown: MinuteOfDay;
  bedtime: MinuteOfDay;
  wake: MinuteOfDay;
}

export interface Settings {
  schedule: Schedule;
  germanGoalMin: number;
  driftCapMin: number;
  passOptionsMin: number[];
  curfewAllow: { categories: CategoryId[]; hosts: string[] };
  curfewExtMin: number;
  curfewExtPerNight: number;
  idleThresholdSec: number;
  idleGraceSec: number;
  dayCutoffHour: number;
}

export interface GermanTarget {
  id: string;
  name: string;
  url: string;
}

export interface LastGerman {
  url: string;
  title?: string;
  at: number;
}

// ===== 计时 =====

export type IdleState = 'active' | 'idle' | 'locked';

export interface TabInfo {
  tabId: number;
  url: string;
  title?: string;
  incognito: boolean;
  audible?: boolean;
}

/** content 上报的页面级信号；url 不匹配当前 URL 即失效 */
export interface PageInfo {
  url: string;
  channel?: ChannelSignal;
  mediaPlaying?: boolean;
}

export interface Override {
  tabId: number;
  url: string;
  category: CategoryId;
}

export type TrackerEvent =
  | ({ type: 'tab-activated'; windowId: number; at: number } & TabInfo)
  | ({ type: 'tab-updated'; windowId: number; at: number } & TabInfo)
  | { type: 'tab-removed'; tabId: number; at: number }
  /** windowId = -1：所有窗口失焦 */
  | { type: 'window-focus'; windowId: number; at: number }
  | { type: 'idle-changed'; state: IdleState; at: number }
  | { type: 'page'; tabId: number; page: PageInfo; at: number }
  | { type: 'override'; override: Override | null; at: number }
  | { type: 'heartbeat'; at: number }
  /** 配置变更：分类可能变化，对账即可 */
  | { type: 'reclassify'; at: number }
  | {
      type: 'sync';
      at: number;
      focusedWindowId: number | null;
      idleState: IdleState;
      tabs: Array<{ windowId: number } & TabInfo>;
    };

export interface ActiveSegment {
  id: string;
  windowId: number;
  tabId: number;
  url: string;
  host: string;
  title?: string;
  incognito: boolean;
  category: CategoryId;
  source: ClassifySource;
  channel?: ChannelSignal;
  startedAt: number;
  /** 尚未落库部分的起点 */
  pieceStart: number;
}

/** 落库单位：某段在某逻辑日内的一截 */
export interface Piece {
  segId: string;
  date: string;
  start: number;
  end: number;
  host: string;
  url: string;
  title?: string;
  category: CategoryId;
  source: ClassifySource;
  channel?: ChannelSignal;
  incognito: boolean;
}

export interface TrackerState {
  focusedWindowId: number | null;
  /** windowId → 该窗口 active tab */
  activeTabs: Record<number, TabInfo>;
  /** tabId → content 上报的页面信号 */
  pages: Record<number, PageInfo>;
  override: Override | null;
  idleState: IdleState;
  /** 水位：最后一次有正证据的活动时刻 */
  lastActiveAt: number;
  current: ActiveSegment | null;
}

export interface TrackerDeps {
  idleGraceSec: number;
  idleThresholdSec: number;
  dayCutoffHour: number;
  classify(url: string, channel?: ChannelSignal): ClassifyResult | null;
}

export interface StepResult {
  state: TrackerState;
  pieces: Piece[];
}

// ===== 策略 =====

export type Phase = 'day' | 'winddown' | 'curfew';

export interface Pass {
  site: string;
  intent: string;
  minutes: number;
  grantedAt: number;
  until: number;
}

export type Banner =
  | { kind: 'pass'; until: number }
  | { kind: 'winddown'; bedtimeAt: number }
  | { kind: 'late'; since: number }
  | { kind: 'ext'; until: number };

export type BlockReason = 'cap' | 'expired' | 'winddown' | 'curfew';

export type Verdict =
  | { kind: 'allow'; banner?: Banner }
  | { kind: 'gate'; waitSec: number; options: number[]; passesToday: number; driftLeftMin: number }
  | { kind: 'block'; reason: BlockReason; canExtend: boolean; canRetry: boolean };

// ===== 数据（IndexedDB） =====

export interface SessionRow extends Piece {
  /** `${segId}|${date}` */
  id: string;
}

export interface UsageRow {
  date: string;
  category: CategoryId;
  host: string;
  seconds: number;
}

export interface DayRow {
  date: string;
  firstAt: number;
  lastAt: number;
}

export type EventType = 'pass' | 'curfew-ext' | 'go-german' | 'mark-channel';

export interface EventRow {
  id?: number;
  date: string;
  at: number;
  type: EventType;
  site?: string;
  intent?: string;
  minutes?: number;
  reason?: string;
  category?: CategoryId;
  name?: string;
}
