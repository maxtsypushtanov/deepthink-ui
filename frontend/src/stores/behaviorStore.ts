import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BehaviorEvent =
  | 'reasoning_expand'
  | 'strategy_override'
  | 'calendar_use'
  | 'inspect_open'
  | 'message_sent';

/** EWMA smoothing factor for new events (alpha) */
const EWMA_ALPHA = 0.1;
/** Decay factor applied to affinities on each message_sent when the feature was not used */
const EWMA_DECAY = 0.98;

interface BehaviorState {
  totalMessages: number;
  reasoningExpandCount: number;
  strategyOverrideCount: number;
  calendarUsageCount: number;
  inspectPanelOpenCount: number;

  // EWMA affinity scores (0.0 – 1.0)
  reasoningAffinity: number;
  strategyAffinity: number;
  calendarAffinity: number;

  // Derived boolean preferences (backwards compat)
  showReasoningByDefault: boolean;
  showStrategyInComposer: boolean;
  autoOpenCalendar: boolean;
  minimalConfidenceBar: boolean;

  // Manual overrides (from Settings)
  overrides: {
    alwaysShowReasoning: boolean | null;
    alwaysShowStrategy: boolean | null;
    showCalendarInSidebar: boolean | null;
  };

  trackEvent: (event: BehaviorEvent) => void;
  setOverride: (key: keyof BehaviorState['overrides'], value: boolean | null) => void;
}

/** Derive boolean preferences from EWMA affinities + overrides */
function derivePreferences(state: Pick<BehaviorState, 'reasoningAffinity' | 'strategyAffinity' | 'calendarAffinity' | 'totalMessages' | 'reasoningExpandCount' | 'overrides'>) {
  const { reasoningAffinity, strategyAffinity, calendarAffinity, totalMessages, reasoningExpandCount, overrides } = state;
  return {
    showReasoningByDefault: overrides.alwaysShowReasoning ?? (reasoningAffinity > 0.5),
    showStrategyInComposer: overrides.alwaysShowStrategy ?? (strategyAffinity > 0.5),
    autoOpenCalendar: overrides.showCalendarInSidebar ?? (calendarAffinity > 0.5),
    minimalConfidenceBar: totalMessages > 50 && reasoningExpandCount === 0,
  };
}

/** Update a single EWMA affinity: blend new signal with previous value */
function ewmaUpdate(prev: number, fired: boolean): number {
  return EWMA_ALPHA * (fired ? 1 : 0) + (1 - EWMA_ALPHA) * prev;
}

/** Clamp a value to [0, 1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export const useBehaviorStore = create<BehaviorState>()(
  persist(
    (set, get) => ({
      totalMessages: 0,
      reasoningExpandCount: 0,
      strategyOverrideCount: 0,
      calendarUsageCount: 0,
      inspectPanelOpenCount: 0,

      reasoningAffinity: 0,
      strategyAffinity: 0,
      calendarAffinity: 0,

      showReasoningByDefault: false,
      showStrategyInComposer: false,
      autoOpenCalendar: false,
      minimalConfidenceBar: false,

      overrides: {
        alwaysShowReasoning: null,
        alwaysShowStrategy: null,
        showCalendarInSidebar: null,
      },

      trackEvent: (event) => {
        set((s) => {
          const next = { ...s };

          // Track which feature-specific events fired in this call
          let reasoningFired = false;
          let strategyFired = false;
          let calendarFired = false;

          switch (event) {
            case 'reasoning_expand':
              next.reasoningExpandCount++;
              reasoningFired = true;
              break;
            case 'strategy_override':
              next.strategyOverrideCount++;
              strategyFired = true;
              break;
            case 'calendar_use':
              next.calendarUsageCount++;
              calendarFired = true;
              break;
            case 'inspect_open':
              next.inspectPanelOpenCount++;
              break;
            case 'message_sent':
              next.totalMessages++;
              // On message_sent, decay all affinities that didn't fire
              next.reasoningAffinity = clamp01(s.reasoningAffinity * EWMA_DECAY);
              next.strategyAffinity = clamp01(s.strategyAffinity * EWMA_DECAY);
              next.calendarAffinity = clamp01(s.calendarAffinity * EWMA_DECAY);
              break;
          }

          // EWMA update for feature events
          if (reasoningFired) {
            next.reasoningAffinity = clamp01(ewmaUpdate(s.reasoningAffinity, true));
          }
          if (strategyFired) {
            next.strategyAffinity = clamp01(ewmaUpdate(s.strategyAffinity, true));
          }
          if (calendarFired) {
            next.calendarAffinity = clamp01(ewmaUpdate(s.calendarAffinity, true));
          }

          return { ...next, ...derivePreferences(next) };
        });
      },

      setOverride: (key, value) => {
        set((s) => {
          const overrides = { ...s.overrides, [key]: value };
          return { overrides, ...derivePreferences({ ...s, overrides }) };
        });
      },
    }),
    { name: 'deepthink-behavior' },
  ),
);
