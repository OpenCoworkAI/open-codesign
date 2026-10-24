import { useT } from '@open-codesign/i18n';
import type { LibraryDesignSystemDetail } from '@open-codesign/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../store';
import '../views/hub/DesignSystemsTab.css';

export function DesignSystemWorkspaceActions() {
  const t = useT();
  const id = useCodesignStore((s) => s.currentDesignId);
  const design = useCodesignStore((s) => s.designs.find((d) => d.id === s.currentDesignId));
  const running = useCodesignStore((s) =>
    s.currentDesignId ? Boolean(s.generationByDesign[s.currentDesignId]) : false,
  );
  const source = useCodesignStore((s) => s.previewSource);
  const [detail, setDetail] = useState<LibraryDesignSystemDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const systemId = design?.designSystemId;
  const previousRun = useRef(false);
  const active = useRef(id);
  active.current = id;
  const validate = useCallback(async () => {
    if (!systemId || !window.codesign?.designSystems) return;
    const ticket = id;
    setBusy(true);
    setError('');
    try {
      const result = await window.codesign.designSystems.validate(systemId);
      if (active.current === ticket) {
        useCodesignStore.getState().setPreviewSource(result.previewSource);
        setDetail(result);
      }
    } catch (err) {
      if (active.current === ticket) setError(String(err));
    } finally {
      if (active.current === ticket) setBusy(false);
    }
  }, [id, systemId]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setError('');
    setBusy(false);
    if (systemId && source !== null && window.codesign?.designSystems)
      void window.codesign.designSystems
        .get(systemId)
        .then((result) => {
          if (live) setDetail(result);
        })
        .catch((err) => {
          if (live) setError(String(err));
        });
    return () => {
      live = false;
    };
  }, [systemId, source]);
  useEffect(() => {
    if (previousRun.current && !running && systemId) void validate();
    previousRun.current = running;
  }, [running, systemId, validate]);
  if (!id || typeof window === 'undefined' || !window.codesign?.designSystems) return null;
  return (
    <div className="system-library-actions">
      {systemId ? (
        <>
          <span className="system-status" title={detail?.system.issues.join('\n')}>
            {t(detail?.system.status === 'ready' ? 'library.ready' : 'library.draft')}
          </span>
          <button
            type="button"
            className="system-action"
            disabled={busy || running}
            onClick={() => void validate()}
          >
            {t(busy ? 'library.checking' : 'library.validate')}
          </button>
          <button
            type="button"
            className="system-action"
            disabled={busy || running}
            onClick={() => {
              const store = useCodesignStore.getState();
              store.setHubTab('resources');
              store.setView('hub');
            }}
          >
            {t('library.back')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="system-action"
          disabled={!source || busy || running}
          onClick={() => {
            setBusy(true);
            setError('');
            void window.codesign?.designSystems
              .import(id)
              .then((imported) => {
                if (!imported || active.current !== id) return;
                const store = useCodesignStore.getState();
                store.setHubTab('resources');
                store.setView('hub');
              })
              .catch((err) => setError(String(err)))
              .finally(() => setBusy(false));
          }}
        >
          {t('library.saveFromDesign')}
        </button>
      )}
      {error || detail?.system.issues.length ? (
        <span
          className="system-error"
          role="alert"
          title={error || detail?.system.issues.join('\n')}
        >
          {error || detail?.system.issues[0]}
        </span>
      ) : null}
    </div>
  );
}
