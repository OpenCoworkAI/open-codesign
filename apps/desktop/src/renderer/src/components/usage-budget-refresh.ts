import { nextLocalMidnight } from '@open-codesign/shared';
import { useEffect, useRef, useState } from 'react';
import type { UsageBudgetResult } from '../../../preload/index';
import { useCodesignStore } from '../store';

/**
 * Reloads the current design's journal totals.
 * A cancelled run is removed before lastUsage changes, so settlement is a
 * separate refresh signal. The same subscription also reloads at the next
 * local midnight and when the window is focused or shown again.
 */
export function useDesignUsageBudget(onError: (error: unknown) => void): UsageBudgetResult | null {
  const designId = useCodesignStore((state) => state.currentDesignId);
  const lastUsage = useCodesignStore((state) => state.lastUsage);
  const settledGenerationIds = useCodesignStore((state) => state.settledGenerationIds);
  const [budget, setBudget] = useState<UsageBudgetResult | null>(null);
  const reportedError = useRef<string | null>(null);
  const shownDesignId = useRef<string | null>(null);

  // Cancel records the settlement before lastUsage can change, and midnight
  // does not change either value. Both are refresh signals for this effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh signals are not read by the request
  useEffect(() => {
    const readUsage = window.codesign?.usageBudget;
    if (!designId || typeof readUsage !== 'function') {
      setBudget(null);
      return;
    }
    if (shownDesignId.current !== designId) {
      shownDesignId.current = designId;
      setBudget(null);
    }

    let active = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      void readUsage(designId).then(
        (next) => {
          if (!active || current !== request) return;
          reportedError.current = null;
          setBudget(next);
        },
        (error: unknown) => {
          if (!active || current !== request) return;
          setBudget(null);
          const description = error instanceof Error ? error.message : String(error);
          if (reportedError.current === description) return;
          reportedError.current = description;
          onError(error);
        },
      );
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = Date.now();
      timer = setTimeout(() => {
        load();
        arm();
      }, nextLocalMidnight(now) - now);
    };

    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      load();
    };

    load();
    arm();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [designId, lastUsage, settledGenerationIds, onError]);

  return budget;
}
