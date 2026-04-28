import { useEffect } from 'react';
import { useCodesignStore } from '../store';

/** Wires renderer-side subscriptions to the engine:v1:* broadcast channels.
 *
 * Run-state events feed `engineeringRunStateByDesign`. Log events are
 * dropped for now (the renderer doesn't yet show a log pane); preserving
 * the subscription means we keep the IPC channel warm and can render logs
 * later without re-plumbing.
 *
 * Also auto-starts the dev server when the active design switches to an
 * engineering-mode design that has no existing run state. The auto-start
 * is fire-and-forget — failures surface via the toast in startEngineeringSession.
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

  useEffect(() => {
    if (currentDesignId === null) return;
    const design = designs.find((d) => d.id === currentDesignId);
    if (design === undefined || design.mode !== 'engineering') return;
    const existing = runStates[currentDesignId];
    if (existing !== undefined) return;
    void startEngineeringSession(currentDesignId);
  }, [currentDesignId, designs, runStates, startEngineeringSession]);
}
