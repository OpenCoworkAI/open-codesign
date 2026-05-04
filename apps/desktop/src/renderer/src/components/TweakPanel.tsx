import { useT } from '@open-codesign/i18n';
import {
  type EditmodeBlock,
  type EditmodeTokens,
  type EditmodeTokenValue,
  parseEditmodeBlock,
  parseTweakSchema,
  replaceEditmodeBlock,
  type TokenSchemaEntry,
  type TweakSchema,
} from '@open-codesign/shared';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { stablePreviewSourceKey } from '../preview/helpers';
import { persistTweakTokensToWorkspace } from '../preview/tweak-persistence';
import { useCodesignStore } from '../store';
import {
  ColorSwatch,
  humanize,
  isColorString,
  NumberInput,
  RangeSlider,
  SegmentedPicker,
  Switch,
  TextInput,
} from './TweakPanel.inputs';

function TokenRow({
  tokenKey,
  value,
  onChange,
  pickColorLabel,
  schemaEntry,
}: {
  tokenKey: string;
  value: EditmodeTokenValue;
  onChange: (next: EditmodeTokenValue) => void;
  pickColorLabel: string;
  schemaEntry?: TokenSchemaEntry | undefined;
}) {
  const labelText = humanize(tokenKey);

  // Schema-driven render — agent declared the control kind explicitly.
  if (schemaEntry) {
    if (schemaEntry.kind === 'boolean') {
      const v = typeof value === 'boolean' ? value : Boolean(value);
      return (
        <div className="flex items-center justify-between gap-[var(--space-3)] py-[var(--space-1_5)]">
          <span className="truncate text-[12px] text-[var(--color-text-primary)]">{labelText}</span>
          <Switch checked={v} onChange={(next) => onChange(next)} label={labelText} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-[var(--space-1_5)] py-[var(--space-1)]">
        <span
          className="text-[10px] uppercase text-[var(--color-text-muted)]"
          style={{ letterSpacing: 'var(--tracking-label)' }}
        >
          {labelText}
        </span>
        {schemaEntry.kind === 'color' ? (
          <ColorSwatch
            value={typeof value === 'string' ? value : '#000000'}
            onChange={(v) => onChange(v)}
            pickColorLabel={pickColorLabel}
          />
        ) : schemaEntry.kind === 'number' ? (
          <RangeSlider
            value={typeof value === 'number' ? value : 0}
            min={schemaEntry.min ?? 0}
            max={schemaEntry.max ?? 100}
            step={schemaEntry.step ?? 1}
            unit={schemaEntry.unit}
            onChange={(v) => onChange(v)}
          />
        ) : schemaEntry.kind === 'enum' ? (
          <SegmentedPicker
            value={typeof value === 'string' ? value : (schemaEntry.options[0] ?? '')}
            options={schemaEntry.options}
            onChange={(v) => onChange(v)}
          />
        ) : (
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChange={(v) => onChange(v)}
            placeholder={schemaEntry.placeholder}
          />
        )}
      </div>
    );
  }

  // Fallback heuristic — same as before.
  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-[var(--space-3)] py-[var(--space-1_5)]">
        <span className="truncate text-[12px] text-[var(--color-text-primary)]">{labelText}</span>
        <Switch checked={value} onChange={(v) => onChange(v)} label={labelText} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-1_5)] py-[var(--space-1)]">
      <span
        className="text-[10px] uppercase text-[var(--color-text-muted)]"
        style={{ letterSpacing: 'var(--tracking-label)' }}
      >
        {labelText}
      </span>
      {isColorString(value) ? (
        <ColorSwatch value={value} onChange={(v) => onChange(v)} pickColorLabel={pickColorLabel} />
      ) : typeof value === 'number' ? (
        <NumberInput value={value} onChange={(v) => onChange(v)} />
      ) : typeof value === 'string' ? (
        <TextInput value={value} onChange={(v) => onChange(v)} />
      ) : null}
    </div>
  );
}

export function TweakPanel({ iframeRef }: { iframeRef: RefObject<HTMLIFrameElement | null> }) {
  const t = useT();
  const previewSource = useCodesignStore((s) => s.previewSource);
  const setPreviewSource = useCodesignStore((s) => s.setPreviewSource);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const block: EditmodeBlock | null = useMemo(
    () => (previewSource ? parseEditmodeBlock(previewSource) : null),
    [previewSource],
  );

  const schema: TweakSchema | null = useMemo(
    () => (previewSource ? parseTweakSchema(previewSource) : null),
    [previewSource],
  );
  const sourceKey = useMemo(
    () => (previewSource ? stablePreviewSourceKey(previewSource) : ''),
    [previewSource],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: currentDesignId and sourceKey intentionally reset the transient panel state when the user switches designs or a new artifact structure loads.
  useEffect(() => {
    setOpen(false);
  }, [currentDesignId, sourceKey]);

  // Live working copy — drives the UI and the postMessage stream to the iframe
  // without paying for a full srcdoc reload on every keystroke. Persistence
  // back into `previewSource` is debounced (see persistTimer below).
  const [liveTokens, setLiveTokens] = useState<EditmodeTokens | null>(null);
  const liveSigRef = useRef<string>('');
  useEffect(() => {
    if (!block) {
      setLiveTokens(null);
      liveSigRef.current = '';
      return;
    }
    const sig = Object.keys(block.tokens).sort().join('|');
    // Only resync from store when the *schema* (key set) changes — this happens
    // on a new artifact load. Otherwise we'd clobber the user's in-flight edits
    // each time `setPreviewSource` settles from our own debounce.
    if (sig !== liveSigRef.current) {
      setLiveTokens({ ...block.tokens });
      liveSigRef.current = sig;
    }
  }, [block]);

  const initialTokensRef = useRef<EditmodeTokens | null>(null);
  useEffect(() => {
    if (!block) {
      initialTokensRef.current = null;
      return;
    }
    const sig = Object.keys(block.tokens).sort().join('|');
    if (initialTokensRef.current === null || liveSigRef.current !== sig) {
      initialTokensRef.current = { ...block.tokens };
    }
  }, [block]);

  // Debounced persist back to the artifact source so reload / snapshot / export
  // see the tweaked state. Live updates have already gone via postMessage.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent): void {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!previewSource) return null;
  const entries = liveTokens ? Object.entries(liveTokens) : [];
  const hasTokens = entries.length > 0;

  function postLive(tokens: EditmodeTokens): void {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: 'codesign:tweaks:update', tokens }, '*');
  }

  function schedulePersist(tokens: EditmodeTokens): void {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const source = useCodesignStore.getState().previewSource;
      if (!source) return;
      const designId = useCodesignStore.getState().currentDesignId;
      const optimistic = replaceEditmodeBlock(source, tokens);
      setPreviewSource(optimistic);

      const files = window.codesign?.files;
      if (!designId || !files?.write) return;

      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const latestSource = useCodesignStore.getState().previewSource ?? optimistic;
          const result = await persistTweakTokensToWorkspace({
            designId,
            previewSource: latestSource,
            tokens,
            read: files.read,
            write: files.write,
          });
          if (useCodesignStore.getState().currentDesignId === designId) {
            setPreviewSource(result.content);
          }
        })
        .catch((err) => {
          useCodesignStore.getState().pushToast({
            variant: 'error',
            title: t('projects.notifications.saveFailed'),
            description: err instanceof Error ? err.message : t('errors.unknown'),
          });
        });
    }, 400);
  }

  function applyTokens(next: EditmodeTokens): void {
    setLiveTokens(next);
    postLive(next);
    schedulePersist(next);
  }

  function applyChange(key: string, next: EditmodeTokenValue): void {
    if (!liveTokens) return;
    applyTokens({ ...liveTokens, [key]: next });
  }

  function reset(): void {
    if (initialTokensRef.current) applyTokens({ ...initialTokensRef.current });
  }

  const isDirty =
    initialTokensRef.current !== null &&
    JSON.stringify(initialTokensRef.current) !== JSON.stringify(liveTokens);

  const titleText = t('tweaks.title');
  const closeText = t('tweaks.close');
  const resetText = t('tweaks.reset');
  const openLabel = t('tweaks.openLabel');
  const pickColorLabel = t('tweaks.pickColor');
  const emptyTitle = t('tweaks.emptyTitle');
  const emptyHint = t('tweaks.emptyHint');
  const countBadge = hasTokens ? String(entries.length) : '—';

  return (
    <div ref={panelRef} className="absolute right-[var(--space-4)] bottom-[var(--space-4)] z-20">
      {open ? (
        <div
          aria-label={titleText}
          className="flex w-[280px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] backdrop-blur"
        >
          <div className="flex items-center justify-between gap-[var(--space-2)] border-b border-[var(--color-border-subtle)] px-[var(--space-3)] py-[var(--space-2)]">
            <div className="flex min-w-0 flex-1 select-none items-center gap-[var(--space-2)]">
              <SlidersHorizontal
                className="h-[14px] w-[14px] text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <span
                className="text-[13px] text-[var(--color-text-primary)]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {titleText}
              </span>
              <span
                className="rounded-full bg-[var(--color-surface-active)] px-[6px] py-[1px] text-[10px] text-[var(--color-text-muted)]"
                style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
              >
                {countBadge}
              </span>
            </div>
            <div className="flex items-center gap-[var(--space-1)]">
              <button
                type="button"
                onClick={reset}
                disabled={!isDirty}
                title={resetText}
                aria-label={resetText}
                className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-30"
              >
                <RotateCcw className="h-[12px] w-[12px]" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title={closeText}
                aria-label={closeText}
                className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-[14px] w-[14px]" aria-hidden="true" />
              </button>
            </div>
          </div>

          {hasTokens ? (
            <div className="flex max-h-[60vh] flex-col gap-[var(--space-1)] overflow-y-auto px-[var(--space-3)] py-[var(--space-2)]">
              {entries.map(([key, value]) => (
                <TokenRow
                  key={key}
                  tokenKey={key}
                  value={value}
                  onChange={(next) => applyChange(key, next)}
                  pickColorLabel={pickColorLabel}
                  schemaEntry={schema?.[key]}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-[var(--space-1_5)] px-[var(--space-3)] py-[var(--space-3)]">
              <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                {emptyTitle}
              </div>
              <div className="text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]">
                {emptyHint}
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={openLabel}
          aria-expanded={false}
          className="inline-flex h-[30px] items-center gap-[var(--space-1_5)] rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] text-[12px] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] backdrop-blur transition-[background-color,color,transform] duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-[var(--scale-press-down)]"
        >
          <SlidersHorizontal className="h-[13px] w-[13px]" aria-hidden="true" />
          <span>{titleText}</span>
          <span
            className="rounded-full bg-[var(--color-surface-active)] px-[6px] py-[1px] text-[10px] text-[var(--color-text-muted)]"
            style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
          >
            {countBadge}
          </span>
        </button>
      )}
    </div>
  );
}
