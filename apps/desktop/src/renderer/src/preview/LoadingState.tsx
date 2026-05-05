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
}

export function LoadingState({ stage: stageProp }: LoadingStateProps = {}) {
  const t = useT();
  const storeStage = useCodesignStore((s) => s.generationStage);

  const stage = stageProp ?? storeStage;

  const activeStage: GenerationStage = stage === 'idle' || stage === 'error' ? 'thinking' : stage;
  const progress = STAGE_PROGRESS[stage];

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background-secondary)] p-[var(--space-8)]">
      <div className="w-full max-w-[520px] rounded-[var(--radius-xl)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-6)] py-[var(--space-5)] shadow-[var(--shadow-soft)]">
        <div className="mb-[var(--space-4)] flex items-center gap-[var(--space-3)]">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-tint)] text-[var(--color-accent)]">
            <StageIcon stage={activeStage} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
              {t('preview.loading.title')}
            </div>
            <div className="mt-[2px] text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              {t(`loading.stage.${activeStage}`)}
            </div>
          </div>
        </div>
        <progress
          value={progress}
          max={MAX_PROGRESS}
          aria-label={t(`loading.stage.${activeStage}`)}
          className="h-1 w-full appearance-none rounded-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--color-border-muted)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--color-accent)]"
        />
        <div className="mt-[var(--space-3)] text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]">
          {t('preview.loading.body', {
            defaultValue: 'The preview will appear as soon as there is renderable source.',
          })}
        </div>
      </div>
    </div>
  );
}

// Re-export stage list for tests
export { STAGES };
