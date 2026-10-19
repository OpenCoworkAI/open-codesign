import { useT } from '@open-codesign/i18n';
import { useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../store';

export function DesignSourceControl() {
  const t = useT();
  const designId = useCodesignStore((s) => s.currentDesignId);
  const design = useCodesignStore((s) => s.designs.find((d) => d.id === s.currentDesignId));
  const entry = useCodesignStore((s) => (designId ? s.sourceEntryByDesign[designId] : undefined));
  const busy = useCodesignStore((s) => Boolean(designId && s.generationByDesign[designId]));
  const refresh = useCodesignStore((s) => s.refreshSourceEntry);
  const select = useCodesignStore((s) => s.selectDesignSource);
  const [open, setOpen] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    // A rebind or external file change requires fresh host metadata even when the design ID is unchanged.
    void design?.workspacePath;
    void design?.updatedAt;
    epoch.current++;
    setOpen(false);
    setSaving(false);
    setError(null);
    if (!designId || !window.codesign?.sourceEntry) return;
    let cancelled = false;
    void refresh(designId).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : t('errors.unknown'));
    });
    return () => {
      cancelled = true;
      epoch.current++;
    };
  }, [designId, design?.workspacePath, design?.updatedAt, refresh, t]);

  useEffect(() => {
    if (!open || !designId) return;
    let cancelled = false;
    setPaths([]);
    setPath('');
    void window.codesign?.files
      .list(designId)
      .then((files) => {
        if (!cancelled)
          setPaths(
            files.filter((file) => /\.(html?|jsx|tsx)$/i.test(file.path)).map((file) => file.path),
          );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('errors.unknown'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, designId, t]);

  if (
    typeof window === 'undefined' ||
    !window.codesign?.sourceEntry ||
    entry?.status === 'not-applicable'
  )
    return null;
  const blocked = entry?.status === 'invalid' || entry?.status === 'needs-selection';
  const source =
    entry && (entry.status === 'ready' || entry.status === 'planned') ? entry.source : null;
  const buttonClass =
    'rounded border border-[var(--color-border)] px-2 py-1 text-[var(--text-xs)] disabled:opacity-50';
  return (
    <div className="border-b border-[var(--color-border-muted)] px-3 py-2 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {t('sourceEntry.primary')}
          {source ? `: ${source.path}` : ''}
        </span>
        {blocked ? <span role="status">{t('sourceEntry.needsSelection')}</span> : null}
        <button
          type="button"
          className={buttonClass}
          disabled={busy || saving || !entry?.workspacePath}
          onClick={() => setOpen(!open)}
        >
          {t('sourceEntry.choose')}
        </button>
        {blocked && designId ? (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              void refresh(designId).catch((reason: unknown) => setError(String(reason)));
            }}
          >
            {t('sourceEntry.reload')}
          </button>
        ) : null}
      </div>
      {open ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!designId || !path || busy || saving) return;
            setSaving(true);
            setError(null);
            const ticket = epoch.current;
            void select(designId, path)
              .then(() => {
                if (ticket === epoch.current) setOpen(false);
              })
              .catch((reason: unknown) => {
                if (ticket === epoch.current)
                  setError(reason instanceof Error ? reason.message : t('errors.unknown'));
              })
              .finally(() => {
                if (ticket === epoch.current) setSaving(false);
              });
          }}
        >
          <select
            aria-label={t('sourceEntry.choose')}
            className="max-w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
            value={path}
            disabled={busy || saving}
            onChange={(event) => setPath(event.target.value)}
          >
            <option value="">{t('sourceEntry.choose')}</option>
            {paths.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass} disabled={!path || busy || saving}>
            {t('sourceEntry.useFile')}
          </button>
        </form>
      ) : null}
      {blocked ? <p className="mt-1">{entry.message}</p> : null}
      {error ? (
        <p role="alert" className="mt-1">
          {error}
        </p>
      ) : null}
    </div>
  );
}
