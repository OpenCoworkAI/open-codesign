import { useLayoutEffect } from 'react';
import { useCodesignStore } from '../store';

export function usePreviewErrorLifecycle(
  document: string | null,
  sourceKey: string,
  active = true,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: document and sourceKey intentionally invalidate errors from the previous rendered document.
  useLayoutEffect(() => {
    if (!active) return;
    const state = useCodesignStore.getState();
    // Reset before the new document reports errors, not on its later load event.
    if (state.iframeErrors.length > 0) state.clearIframeErrors();
  }, [document, sourceKey, active]);
}
