import type { CategoryId, ChannelSignal, ClassifySource, Phase, Verdict } from '../core/types';

/** content / popup ↔ SW 消息协议。SW → content 只有 'policy-changed'。 */

export interface ContinueGerman {
  name: string;
  url: string;
}

export interface GateContext {
  url: string;
  host: string;
  site: string;
  category: CategoryId;
  source: ClassifySource;
  channel?: ChannelSignal;
  phase: Phase;
  now: number;
  driftUsedMin: number;
  driftCapMin: number;
  germanTodayMin: number;
  germanGoalMin: number;
  continueGerman: ContinueGerman | null;
  pass?: { intent: string; minutes: number; until: number };
  bedtime: string;
  wake: string;
  curfewExtMin: number;
}

export interface VerdictResponse {
  verdict: Verdict;
  ctx: GateContext | null;
}

export interface PopupState {
  phase: Phase;
  nextChangeAt: number;
  bedtime: string;
  wake: string;
  germanSec: number;
  germanGoalMin: number;
  driftSec: number;
  driftCapMin: number;
  totalSec: number;
  /** popup 所在窗口的 active tab（可能未在计时） */
  tab: {
    tabId: number;
    url: string;
    host: string;
    category: CategoryId;
    source: ClassifySource;
    channel?: ChannelSignal;
    timing: boolean;
    liveSec: number;
  } | null;
  continueGerman: ContinueGerman | null;
  incognitoAllowed: boolean;
}

export type Msg =
  | { type: 'verdict'; url: string }
  | { type: 'page'; url: string; channel?: ChannelSignal; mediaPlaying?: boolean }
  | { type: 'grant'; minutes: number; intent: string }
  | { type: 'retry' }
  | { type: 'curfew-ext'; reason: string }
  | { type: 'mark-channel'; category: CategoryId; tabId?: number }
  | { type: 'go-german'; tabId?: number }
  | { type: 'close-tab' }
  | { type: 'popup-state'; tabId: number | null }
  | { type: 'override'; category: CategoryId; tabId: number }
  | { type: 'add-rule'; pattern: string; category: CategoryId };

export type ActionResult = { ok: true } | { ok: false; reason: string };
