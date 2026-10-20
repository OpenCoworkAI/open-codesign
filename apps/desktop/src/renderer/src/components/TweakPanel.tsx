import { useT } from '@open-codesign/i18n';
import { isTweakCompatibilityNotice } from '@open-codesign/runtime';
import type { EditmodeTokens, EditmodeTokenValue, TokenSchemaEntry } from '@open-codesign/shared';
import { inspectTweakSource } from '@open-codesign/shared';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { isTrustedPreviewMessageSource } from '../preview/helpers';
import {
  createTweakPersistDebounce,
  persistTweakTokensToWorkspace,
  rebaseTweakDraft,
} from '../preview/tweak-persistence';
import type { WorkspacePreviewReadResult } from '../preview/workspace-source';
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

export function shouldSyncPreviewSourceAfterTweakPersist(result: { wrote: boolean }): boolean {
  return !result.wrote;
}

function inferColors(tokens: EditmodeTokens | null): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(tokens ?? {}).map(([key, value]) => [key, isColorString(value)]),
  );
}

function TokenRow({
  tokenKey,
  value,
  onChange,
  pickColorLabel,
  schemaEntry,
  inferredColor,
}: {
  tokenKey: string;
  value: EditmodeTokenValue;
  onChange: (next: EditmodeTokenValue) => void;
  pickColorLabel: string;
  schemaEntry?: TokenSchemaEntry | undefined;
  inferredColor: boolean;
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

  // Inference belongs to the source token, not a partially typed draft.
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
      {inferredColor && typeof value === 'string' ? (
        <ColorSwatch value={value} onChange={(v) => onChange(v)} pickColorLabel={pickColorLabel} />
      ) : typeof value === 'number' ? (
        <NumberInput value={value} onChange={(v) => onChange(v)} />
      ) : typeof value === 'string' ? (
        <TextInput value={value} onChange={(v) => onChange(v)} />
      ) : null}
    </div>
  );
}

interface TweakPanelProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  presentation?: 'floating' | 'inspector';
  source?: WorkspacePreviewReadResult;
  onPersist?: (source: WorkspacePreviewReadResult) => void;
}

export function TweakPanel(props: TweakPanelProps) {
  const designId = useCodesignStore((s) => s.currentDesignId);
  return <TweakPanelEditor key={JSON.stringify([designId, props.source?.path])} {...props} />;
}

function TweakPanelEditor({
  iframeRef,
  presentation = 'floating',
  source,
  onPersist,
}: TweakPanelProps) {
  const t = useT();
  const storedSource = useCodesignStore((s) => s.previewSource);
  const previewSource = source?.content ?? storedSource;
  const setPreviewSource = useCodesignStore((s) => s.setPreviewSource);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const isGenerating = useCodesignStore(
    (s) => currentDesignId !== null && s.generationByDesign?.[currentDesignId] !== undefined,
  );
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const generationRevisionRef = useRef(0);
  const persistDebounce = useMemo(
    () =>
      createTweakPersistDebounce(() => {
        if (mountedRef.current) setSaving(false);
      }),
    [],
  );

  const tweakSource = useMemo(() => inspectTweakSource(previewSource ?? ''), [previewSource]);
  const { block, schema } = tweakSource;
  // Live working copy — drives the UI and the postMessage stream to the iframe
  // without paying for a full srcdoc reload on every keystroke. Persistence
  // back into the workspace is debounced.
  const [liveTokens, setLiveTokens] = useState<EditmodeTokens | null>(block?.tokens ?? null);
  const initialTokensRef = useRef<EditmodeTokens | null>(block?.tokens ?? null);
  const [inference, setInference] = useState(() => ({
    revision: 0,
    colors: inferColors(block?.tokens ?? null),
  }));
  const baselineRef = useRef(previewSource);
  const observedSourceRef = useRef(previewSource);
  const acknowledgedSourceRef = useRef<string | null>(null);
  const latestSourceRef = useRef(previewSource);
  latestSourceRef.current = previewSource;
  useEffect(() => {
    if (saving || persistDebounce.hasPending() || observedSourceRef.current === previewSource)
      return;
    observedSourceRef.current = previewSource;
    if (previewSource === acknowledgedSourceRef.current) return;
    baselineRef.current = previewSource;
    setInference((previous) => ({
      revision: previous.revision + 1,
      colors: inferColors(block?.tokens ?? null),
    }));
    if (!block) {
      setLiveTokens(null);
      initialTokensRef.current = null;
      return;
    }
    setLiveTokens({ ...block.tokens });
    initialTokensRef.current = { ...block.tokens };
  }, [block, previewSource, persistDebounce, saving]);

  useEffect(() => {
    if (!liveTokens) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'codesign:tweaks:update', tokens: liveTokens },
      '*',
    );
  }, [iframeRef, liveTokens]);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      if (
        !mountedRef.current ||
        useCodesignStore.getState().currentDesignId !== currentDesignId ||
        !isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow) ||
        !isTweakCompatibilityNotice(event.data)
      )
        return;
      useCodesignStore.getState().pushToast({
        variant: 'info',
        title: t('tweaks.title'),
        description: t('tweaks.compatibilityNotice'),
      });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [currentDesignId, iframeRef, t]);

  // Debounced persist back to the artifact source so reload / snapshot / export
  // see the tweaked state. Live updates have already gone via postMessage.
  // A file/design switch must invalidate even a save already awaiting a file read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity invalidates pending writes.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      persistDebounce.cancel();
    };
  }, [currentDesignId, source?.path, persistDebounce]);

  useEffect(() => {
    if (!isGenerating || !persistDebounce.hasPending()) return;
    generationRevisionRef.current++;
    persistDebounce.cancel();
    setLiveTokens(block ? { ...block.tokens } : null);
    useCodesignStore.getState().pushToast({
      variant: 'error',
      title: t('projects.notifications.saveFailed'),
      description: 'Tweak save cancelled because generation started.',
    });
  }, [isGenerating, block, t, persistDebounce]);

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
  const hasTokens = tweakSource.status === 'ready' && entries.length > 0;

  function schedulePersist(tokens: EditmodeTokens): void {
    const designId = currentDesignId;
    const path = source?.path;
    if (!baselineRef.current) return;
    const generationRevision = generationRevisionRef.current;
    persistDebounce.schedule(baselineRef.current, tokens, async (baseSource, nextTokens) => {
      const files = window.codesign?.files;
      const canWrite = () => {
        const state = useCodesignStore.getState();
        return (
          mountedRef.current &&
          generationRevisionRef.current === generationRevision &&
          state.currentDesignId === designId &&
          (!designId || state.generationByDesign?.[designId] === undefined)
        );
      };
      const observedSource = latestSourceRef.current;
      setSaving(true);
      try {
        const result = await persistTweakTokensToWorkspace({
          designId,
          previewSource: baseSource,
          path,
          tokens: nextTokens,
          read: files?.read,
          write: files?.write,
          canWrite,
        });
        if (!canWrite()) return;
        baselineRef.current = result.content;
        acknowledgedSourceRef.current = result.content;
        initialTokensRef.current = inspectTweakSource(result.content).block?.tokens ?? null;
        setLiveTokens((draft) => draft && rebaseTweakDraft(result.content, nextTokens, draft));
        // Do not publish an old ACK over an independently refreshed source.
        if (
          latestSourceRef.current === observedSource ||
          latestSourceRef.current === baseSource ||
          latestSourceRef.current === result.content
        ) {
          if (onPersist) onPersist(result);
          else if (shouldSyncPreviewSourceAfterTweakPersist(result)) {
            setPreviewSource(result.content);
          }
        }
        return result;
      } catch (err) {
        // Keep the recoverable draft; neither retry queued edits nor reload over it.
        observedSourceRef.current = latestSourceRef.current;
        useCodesignStore.getState().pushToast({
          variant: 'error',
          title: t('projects.notifications.saveFailed'),
          description: err instanceof Error ? err.message : t('errors.unknown'),
        });
      }
    });
  }

  function applyTokens(next: EditmodeTokens): void {
    setLiveTokens(next);
    schedulePersist(next);
  }

  function applyChange(key: string, next: EditmodeTokenValue): void {
    if (!liveTokens || isGenerating) return;
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
  const emptyTitle =
    tweakSource.status === 'invalid' ? t('tweaks.invalidTitle') : t('tweaks.emptyTitle');
  const emptyHint =
    tweakSource.status === 'invalid'
      ? t('tweaks.invalidHint')
      : tweakSource.status === 'empty'
        ? t('tweaks.declaredEmptyHint')
        : t('tweaks.emptyHint');
  const countBadge = hasTokens ? String(entries.length) : '—';

  const panelBody = (
    <div
      aria-label={titleText}
      className={
        presentation === 'inspector'
          ? 'flex min-h-0 flex-col overflow-hidden'
          : 'flex w-[280px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] backdrop-blur'
      }
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
            disabled={!isDirty || saving || isGenerating}
            title={resetText}
            aria-label={resetText}
            className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:pointer-events-none disabled:opacity-30"
          >
            <RotateCcw className="h-[12px] w-[12px]" aria-hidden="true" />
          </button>
          {presentation === 'floating' ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              title={closeText}
              aria-label={closeText}
              className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors duration-[var(--duration-faster)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <X className="h-[14px] w-[14px]" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="break-all px-[var(--space-3)] pt-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]"
        title={source?.path}
      >
        {t('tweaks.sourceLabel')}: {source?.path ?? t('tweaks.currentPreview')}
      </div>
      {hasTokens ? (
        <fieldset
          disabled={isGenerating}
          aria-busy={saving}
          className="flex min-w-0 max-h-[60vh] flex-col gap-[var(--space-1)] overflow-y-auto px-[var(--space-3)] py-[var(--space-2)] disabled:opacity-50"
        >
          {entries.map(([key, value]) => (
            <TokenRow
              key={`${inference.revision}:${key}`}
              tokenKey={key}
              value={value}
              onChange={(next) => applyChange(key, next)}
              pickColorLabel={pickColorLabel}
              schemaEntry={schema?.[key]}
              inferredColor={inference.colors[key] ?? false}
            />
          ))}
        </fieldset>
      ) : (
        <div
          role={tweakSource.status === 'invalid' ? 'alert' : 'status'}
          className="flex flex-col items-start gap-[var(--space-1_5)] px-[var(--space-3)] py-[var(--space-3)]"
        >
          <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
            {emptyTitle}
          </div>
          <div className="text-[11px] leading-[var(--leading-snug)] text-[var(--color-text-muted)]">
            {emptyHint}
          </div>
          {tweakSource.status === 'invalid' ? (
            <p className="m-0 break-words text-[var(--text-xs)] text-[var(--color-error)]">
              {tweakSource.error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );

  if (presentation === 'inspector') return panelBody;

  return (
    <div ref={panelRef} className="absolute right-[var(--space-4)] bottom-[var(--space-4)] z-20">
      {open ? (
        panelBody
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
