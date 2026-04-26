import { useT } from '@open-codesign/i18n';
import { useEffect, useState } from 'react';
import type { GenerationStage } from '../../store';
import { useCodesignStore } from '../../store';

function useElapsedSeconds(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function GenerationStatusBar() {
  const t = useT();
  const isGenerating = useCodesignStore(
    (s) => s.currentDesignId !== null && s.activeGenerations.has(s.currentDesignId),
  );
  const generationStage = useCodesignStore((s) => s.generationStage);
  const startedAt = useCodesignStore((s) => s.generationStartedAt);
  const currentOperation = useCodesignStore((s) => s.currentOperation);
  const elapsed = useElapsedSeconds(isGenerating ? startedAt : null);

  if (!isGenerating) return null;

  const opTrim = currentOperation?.trim() ?? '';
  const labelFromStage = (s: GenerationStage) => {
    switch (s) {
      case 'sending':
        return t('loading.stage.sending');
      case 'thinking':
        return t('loading.stage.thinking');
      case 'streaming':
        return t('loading.stage.streaming');
      case 'parsing':
        return t('loading.stage.parsing');
      case 'rendering':
        return t('loading.stage.rendering');
      case 'error':
        return t('common.working');
      case 'done':
        return t('common.working');
      case 'idle':
        return t('loading.stage.thinking');
      default:
        return t('common.working');
    }
  };
  const label =
    opTrim.length > 0
      ? opTrim.length > 72
        ? `${opTrim.slice(0, 72)}…`
        : opTrim
      : labelFromStage(generationStage) || t('common.working');

  return (
    <div
      className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1_5)] border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)] text-[11.5px] shrink-0"
      role="status"
    >
      <span className="relative inline-flex w-[8px] h-[8px] shrink-0">
        <span className="absolute inline-block w-full h-full rounded-full bg-[var(--color-accent)] animate-ping opacity-60" />
        <span className="relative inline-block w-full h-full rounded-full bg-[var(--color-accent)]" />
      </span>
      <span
        className="flex-1 min-w-0 truncate font-[ui-monospace,Menlo,monospace] text-[var(--color-text-secondary)]"
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
