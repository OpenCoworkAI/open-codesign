import { useEffect } from 'react';
import { useCodesignStore } from '../store';

/** Wires renderer-side subscriptions to the engine:v1:* broadcast channels.
 *
 * Run-state events feed `engineeringRunStateByDesign`. Log events are
 * dropped for now (the renderer doesn't yet show a log pane); preserving
 * the subscription means we keep the IPC channel warm and can render logs
 * later without re-plumbing.
 *
 * Auto-starts the dev server only when the user is actually on the
 * workspace view for an engineering design that has no run state yet.
 * Sitting on the hub / settings view (or simply having a design selected
 * in the background) must NOT spawn dev servers — booting the app would
 * otherwise silently start whatever engineering project happened to be
 * the previously-selected one. The auto-start is fire-and-forget;
 * failures surface via the toast in startEngineeringSession.
 */
export function useEngineeringWiring(): void {
  useEffect(() => {
    if (!window.codesign) return;
    const offState = window.codesign.engine.onRunState((state) => {
      useCodesignStore.getState().setEngineeringRunState(state);
    });
    const offLog = window.codesign.engine.onLog(() => {
      // No-op for v0.2 — engine logs are visible via app log file.
      // Wired so the IPC channel stays subscribed and future log UI doesn't
      // need a remount.
    });
    return () => {
      offState();
      offLog();
    };
  }, []);

  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const runStates = useCodesignStore((s) => s.engineeringRunStateByDesign);
  const startEngineeringSession = useCodesignStore((s) => s.startEngineeringSession);
  const view = useCodesignStore((s) => s.view);
  const designsViewOpen = useCodesignStore((s) => s.designsViewOpen);

  useEffect(() => {
    if (view !== 'workspace') return;
    if (designsViewOpen) return;
    if (currentDesignId === null) return;
    const design = designs.find((d) => d.id === currentDesignId);
    if (design === undefined || design.mode !== 'engineering') return;
    const existing = runStates[currentDesignId];
    if (existing !== undefined) return;
    void startEngineeringSession(currentDesignId);
  }, [view, designsViewOpen, currentDesignId, designs, runStates, startEngineeringSession]);
}
