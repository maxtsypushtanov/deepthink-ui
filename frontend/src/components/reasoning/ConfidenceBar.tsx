import { useMemo } from 'react';
import type { ThinkingStep } from '@/types';
import { cn } from '@/lib/utils';

type ConfidenceLevel = 'high' | 'medium' | 'low' | 'neutral';

interface Props {
  strategy?: string;
  reasoningTrace?: string;
  onClick?: () => void;
  /** Reduce bar to 1px if user never engages with reasoning */
  minimal?: boolean;
}

// ---- Innovation #3 helpers ----

const HEDGING_PHRASES = [
  'однако', 'с другой стороны', 'не уверен', 'возможно',
  'however', 'but', 'alternatively', "i'm not sure", 'might', 'perhaps',
];

function countSentences(text: string): number {
  const parts = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return Math.max(parts.length, 1);
}

function countHedging(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const phrase of HEDGING_PHRASES) {
    // Count all occurrences of each phrase
    let idx = 0;
    while (true) {
      idx = lower.indexOf(phrase, idx);
      if (idx === -1) break;
      count++;
      idx += phrase.length;
    }
  }
  return count;
}

function computeCotConfidence(steps: ThinkingStep[]): { level: ConfidenceLevel; tooltip: string } {
  const thinkingSteps = steps.filter(s => s.metadata?.type === 'extracted_thinking');
  if (thinkingSteps.length === 0) return { level: 'neutral', tooltip: 'CoT — no extracted thinking found' };

  const allContent = thinkingSteps.map(s => s.content).join(' ');
  const hedgingCount = countHedging(allContent);
  const totalSentences = countSentences(allContent);
  const ratio = hedgingCount / totalSentences;

  if (ratio < 0.15) return { level: 'high', tooltip: `CoT self-consistency: high (hedging ${(ratio * 100).toFixed(0)}%)` };
  if (ratio <= 0.35) return { level: 'medium', tooltip: `CoT self-consistency: medium (hedging ${(ratio * 100).toFixed(0)}%)` };
  return { level: 'low', tooltip: `CoT self-consistency: low (hedging ${(ratio * 100).toFixed(0)}%)` };
}

function computeRubberDuckConfidence(steps: ThinkingStep[]): { level: ConfidenceLevel; tooltip: string } {
  const reviewSteps = steps.filter(s => {
    const t = s.metadata?.type as string | undefined;
    return t && (t.includes('rubber_duck_review') || t.includes('rubber_duck_fix'));
  });

  if (reviewSteps.length === 0) return { level: 'neutral', tooltip: 'Rubber Duck — no review steps found' };

  const reviewContent = reviewSteps.map(s => s.content).join(' ');
  const hasErrors = /ОШИБКА|СОМНИТЕЛЬНО|❌|⚠️/.test(reviewContent);
  const noProblems = /Проблем не обнаружено/.test(reviewContent);

  if (noProblems && !hasErrors) return { level: 'high', tooltip: 'Rubber Duck: no issues found in review' };
  if (hasErrors) return { level: 'medium', tooltip: 'Rubber Duck: issues found and addressed' };
  return { level: 'medium', tooltip: 'Rubber Duck: review completed' };
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 0));
}

function wordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return intersection / union.size;
}

function computeSocraticConfidence(steps: ThinkingStep[]): { level: ConfidenceLevel; tooltip: string } {
  const answers = steps.filter(s => s.metadata?.type === 'socratic_answer');
  if (answers.length < 2) return { level: 'neutral', tooltip: 'Socratic — not enough answers to compare' };

  // Extract first sentence from each answer
  const firstSentences = answers.map(s => {
    const match = s.content.match(/^[^.!?]+/);
    return match ? match[0].trim() : s.content.slice(0, 80);
  });

  // Pairwise comparison of consecutive answers
  let totalOverlap = 0;
  let pairs = 0;
  for (let i = 0; i < firstSentences.length - 1; i++) {
    const setA = wordSet(firstSentences[i]);
    const setB = wordSet(firstSentences[i + 1]);
    totalOverlap += wordOverlap(setA, setB);
    pairs++;
  }
  const avgOverlap = totalOverlap / Math.max(pairs, 1);

  if (avgOverlap > 0.5) return { level: 'high', tooltip: `Socratic: convergent (${(avgOverlap * 100).toFixed(0)}% overlap)` };
  if (avgOverlap < 0.3) return { level: 'low', tooltip: `Socratic: divergent (${(avgOverlap * 100).toFixed(0)}% overlap)` };
  return { level: 'medium', tooltip: `Socratic: moderate agreement (${(avgOverlap * 100).toFixed(0)}% overlap)` };
}

// ---- Innovation #10 helper ----

const DOMAIN_LABELS: Record<string, string> = {
  software_engineering: 'SWE',
  mathematics: 'Math',
  science: 'Sci',
  philosophy: 'Phil',
  law: 'Law',
  medicine: 'Med',
  finance: 'Fin',
  education: 'Edu',
  creative_writing: 'CW',
  data_science: 'DS',
  cybersecurity: 'Sec',
  devops: 'DevOps',
  general: 'Gen',
};

function detectDomain(steps: ThinkingStep[]): string | null {
  for (const step of steps) {
    if (step.metadata?.domain && typeof step.metadata.domain === 'string') {
      return step.metadata.domain;
    }
  }
  return null;
}

// ---- Main logic ----

function computeConfidence(strategy: string, steps: ThinkingStep[]): { level: ConfidenceLevel; tooltip: string } {
  if (!strategy || strategy === 'none') {
    return { level: 'neutral', tooltip: 'No confidence metric for this strategy' };
  }

  // Innovation #3: Self-consistency confidence for COT/Rubber Duck/Socratic
  if (strategy === 'cot') return computeCotConfidence(steps);
  if (strategy === 'rubber_duck') return computeRubberDuckConfidence(steps);
  if (strategy === 'socratic') return computeSocraticConfidence(steps);

  if (strategy === 'best_of_n') {
    // Check if candidates agreed
    const votes = steps.filter(s => s.metadata?.vote || s.metadata?.selected);
    const contents = steps.map(s => s.content?.slice(0, 100));
    const unique = new Set(contents);
    if (steps.length === 0) return { level: 'neutral', tooltip: 'Best-of-N' };
    if (unique.size <= 1) return { level: 'high', tooltip: `${steps.length}/${steps.length} candidates agreed` };
    if (unique.size <= Math.ceil(steps.length / 2)) return { level: 'medium', tooltip: 'Partial consensus among candidates' };
    return { level: 'low', tooltip: 'No consensus — candidates diverged' };
  }

  if (strategy === 'tree_of_thoughts') {
    const scores = steps
      .map(s => (s.metadata?.score as number) || 0)
      .filter(s => s > 0);
    if (scores.length === 0) return { level: 'neutral', tooltip: 'Tree of Thoughts' };
    const maxScore = Math.max(...scores);
    if (maxScore > 0.8) return { level: 'high', tooltip: `Best branch score: ${maxScore.toFixed(2)}` };
    if (maxScore > 0.5) return { level: 'medium', tooltip: `Best branch score: ${maxScore.toFixed(2)}` };
    return { level: 'low', tooltip: `Best branch score: ${maxScore.toFixed(2)}` };
  }

  if (strategy === 'budget_forcing') {
    const rounds = steps.length;
    if (rounds <= 2) return { level: 'high', tooltip: `Stabilized in ${rounds} rounds` };
    if (rounds <= 3) return { level: 'medium', tooltip: `Used ${rounds} rounds` };
    return { level: 'low', tooltip: `Required all ${rounds} rounds` };
  }

  if (strategy === 'persona_council') {
    const opinions = steps.map(s => s.content?.slice(0, 50));
    const unique = new Set(opinions);
    if (steps.length === 0) return { level: 'neutral', tooltip: 'Persona Council' };
    if (unique.size <= Math.ceil(steps.length * 0.5)) return { level: 'high', tooltip: 'Experts reached consensus' };
    return { level: 'medium', tooltip: 'Mixed expert opinions' };
  }

  return { level: 'neutral', tooltip: strategy };
}

const LEVEL_COLORS: Record<ConfidenceLevel, string> = {
  high: 'bg-confidence-high',
  medium: 'bg-confidence-medium',
  low: 'bg-confidence-low',
  neutral: 'bg-confidence-neutral',
};

export function ConfidenceBar({ strategy, reasoningTrace, onClick, minimal }: Props) {
  const { level, tooltip, domain } = useMemo(() => {
    if (!strategy || !reasoningTrace) return { level: 'neutral' as ConfidenceLevel, tooltip: '', domain: null as string | null };
    let steps: ThinkingStep[] = [];
    try { steps = JSON.parse(reasoningTrace); } catch {}
    const result = computeConfidence(strategy, steps);
    const detectedDomain = detectDomain(steps);
    return { ...result, domain: detectedDomain };
  }, [strategy, reasoningTrace]);

  const handleClick = onClick ? () => {
    import('@/stores/behaviorStore').then(({ useBehaviorStore }) => {
      useBehaviorStore.getState().trackEvent('reasoning_expand');
    }).catch(() => {});
    onClick();
  } : undefined;

  const domainLabel = domain ? (DOMAIN_LABELS[domain] || domain.slice(0, 4)) : null;

  return (
    <div className="group/conf relative flex items-center gap-1.5" title={tooltip}>
      <button
        type="button"
        onClick={handleClick}
        disabled={!handleClick}
        className={cn(
          'flex-1 rounded-full transition-all duration-300 animate-confidence-fill',
          LEVEL_COLORS[level],
          minimal ? 'h-[1px] opacity-30' : 'h-[3px] opacity-60 hover:opacity-100',
          handleClick ? 'cursor-pointer' : 'cursor-default',
        )}
      />
      {/* Innovation #10: Domain expertise label */}
      {domainLabel && !minimal && (
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70 select-none">
          {domainLabel}
        </span>
      )}
      {/* Hover tooltip */}
      {tooltip && (
        <div className="absolute left-0 bottom-full mb-1.5 hidden group-hover/conf:block z-20">
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5 shadow-lg animate-fade-in">
            <p className="text-[11px] text-muted-foreground whitespace-nowrap">{tooltip}</p>
          </div>
        </div>
      )}
    </div>
  );
}
