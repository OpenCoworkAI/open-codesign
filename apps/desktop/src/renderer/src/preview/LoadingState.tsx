import { useT } from '@open-codesign/i18n';
import {
  BrainCircuit,
  CheckCircle,
  Loader,
  PackageOpen,
  RadioTower,
  Send,
  Tv2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenerationStage } from '../store';
import { useCodesignStore } from '../store';

const STAGES: GenerationStage[] = [
  'sending',
  'thinking',
  'streaming',
  'parsing',
  'rendering',
  'done',
];

// 'streaming' is index 2 — value out of 5 steps (0-indexed terminal stage is 'done' at 5)
const STAGE_PROGRESS: Record<GenerationStage, number> = {
  idle: 0,
  sending: 1,
  thinking: 2,
  streaming: 3,
  parsing: 4,
  rendering: 5,
  done: 6,
  error: 0,
};

const MAX_PROGRESS = 6;

function StageIcon({ stage }: { stage: GenerationStage }): ReactNode {
  const cls = 'w-4 h-4 shrink-0';
  switch (stage) {
    case 'sending':
      return <Send className={cls} />;
    case 'thinking':
      return <BrainCircuit className={cls} />;
    case 'streaming':
      return <RadioTower className={cls} />;
    case 'parsing':
      return <PackageOpen className={cls} />;
    case 'rendering':
      return <Tv2 className={cls} />;
    case 'done':
      return <CheckCircle className={cls} />;
    default:
      return <Loader className={`${cls} animate-spin`} />;
  }
}

export interface LoadingStateProps {
  /** Override stage for testing */
  stage?: GenerationStage;
  /** Override token count for testing */
  tokenCount?: number;
}

export function LoadingState({ stage: stageProp, tokenCount: tokenProp }: LoadingStateProps = {}) {
  const t = useT();
  const storeStage = useCodesignStore((s) => s.generationStage);
  const storeTokens = useCodesignStore((s) => s.streamingTokenCount);

  const stage = stageProp ?? storeStage;
  const tokenCount = tokenProp ?? storeTokens;

  const activeStage: GenerationStage = stage === 'idle' || stage === 'error' ? 'thinking' : stage;
  const progress = STAGE_PROGRESS[stage];

  return (
    <div className="h-full p-6">
      <div className="h-full w-full rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col">
        {/* Skeleton header */}
        <div className="px-6 py-5 border-b border-[var(--color-border-subtle)] space-y-3">
          <div className="shimmer h-4 w-40 rounded-[var(--radius-sm)]" />
          <div className="shimmer h-3 w-64 rounded-[var(--radius-sm)]" />
        </div>
        {/* Skeleton body */}
        <div className="flex-1 grid grid-cols-3 gap-4 p-6">
          <div className="shimmer rounded-[var(--radius-lg)]" />
          <div className="shimmer rounded-[var(--radius-lg)]" />
          <div className="shimmer rounded-[var(--radius-lg)]" />
        </div>
        {/* Stage feedback bar */}
        <div className="px-6 py-4 border-t border-[var(--color-border-subtle)] flex flex-col gap-2">
          <div className="loading-stages flex items-center gap-2 text-[var(--color-text-secondary)] text-sm">
            <StageIcon stage={activeStage} />
            <span className="stage-label">{t(`loading.stage.${activeStage}`)}</span>
            {activeStage === 'streaming' && tokenCount > 0 && (
              <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                {tokenCount} tokens
              </span>
            )}
          </div>
          {/* Progress indicator — shows completed steps out of 5 visible stages */}
          <progress
            value={progress}
            max={MAX_PROGRESS}
            aria-label={t(`loading.stage.${activeStage}`)}
            className="w-full h-1 rounded-full appearance-none [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--color-border)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--color-accent)] transition-all duration-300"
          />
        </div>
      </div>
    </div>
  );
}

// Re-export stage list for tests
export { STAGES };
