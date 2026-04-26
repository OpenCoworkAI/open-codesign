import { useT } from '@open-codesign/i18n';
import { ChevronDown, ChevronRight, Loader2, Search, Star, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderRow } from '../../../preload/index';
import { recordAction } from '../lib/action-timeline';
import { useCodesignStore } from '../store';

interface ModelSwitcherProps {
  variant: 'topbar' | 'sidebar';
}

export const MODEL_LIST_SEARCH_THRESHOLD = 12;

function shortenModelLabel(model: string): string {
  const stripped = model.replace(/^(claude-|gpt-|gemini-)/, '');
  return stripped.includes('/') ? (stripped.split('/').pop() ?? stripped) : stripped;
}

export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return models;
  return models.filter((m) => m.toLowerCase().includes(q));
}

export function mergeActiveModelIfMissing(
  models: string[],
  activeId: string | null | undefined,
): string[] {
  if (!activeId || models.includes(activeId)) return models;
  return [activeId, ...models];
}

// ─── Pinned model persistence ─────────────────────────────────────────────

const PINS_KEY = 'open-codesign:pinned-models';

interface PinnedEntry {
  provider: string;
  modelId: string;
}

function loadPins(): PinnedEntry[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PinnedEntry =>
        typeof x === 'object' &&
        x !== null &&
        typeof x.provider === 'string' &&
        typeof x.modelId === 'string',
    );
  } catch {
    return [];
  }
}

function savePins(pins: PinnedEntry[]): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* storage full — ignore */
  }
}

function isPinned(pins: PinnedEntry[], provider: string, modelId: string): boolean {
  return pins.some((p) => p.provider === provider && p.modelId === modelId);
}

function togglePin(pins: PinnedEntry[], provider: string, modelId: string): PinnedEntry[] {
  if (isPinned(pins, provider, modelId)) {
    return pins.filter((p) => !(p.provider === provider && p.modelId === modelId));
  }
  return [...pins, { provider, modelId }];
}

// ─── Provider section state ───────────────────────────────────────────────

interface SectionState {
  models: string[] | null;
  loading: boolean;
  expanded: boolean;
}

export function ModelSwitcher({ variant }: ModelSwitcherProps) {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);

  const [open, setOpen] = useState(false);
  const [providerRows, setProviderRows] = useState<ProviderRow[] | null>(null);
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map());
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState<PinnedEntry[]>(() => loadPins());
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeProvider = config?.provider ?? null;
  const currentModel = config?.modelPrimary ?? null;

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setQuery('');
    }
  }, [open]);

  // Load providers + start fetching models for all when dropdown opens
  useEffect(() => {
    if (!open) return;
    if (!window.codesign?.settings?.listProviders) return;

    void window.codesign.settings.listProviders().then((rows) => {
      setProviderRows(rows);

      setSections((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          if (!next.has(row.provider)) {
            next.set(row.provider, {
              models: null,
              loading: false,
              // Auto-expand active provider; collapse others
              expanded: row.provider === activeProvider,
            });
          }
        }
        return next;
      });

      // Kick off model loads for all providers in parallel
      if (!window.codesign?.models?.listForProvider) return;
      for (const row of rows) {
        setSections((prev) => {
          const cur = prev.get(row.provider);
          if (cur?.models !== null) return prev; // already loaded
          const next = new Map(prev);
          next.set(row.provider, {
            ...(cur ?? { expanded: row.provider === activeProvider }),
            loading: true,
            models: null,
          });
          return next;
        });

        void window.codesign.models
          .listForProvider(row.provider)
          .then((res) => {
            setSections((prev) => {
              const cur = prev.get(row.provider);
              const models = res.ok
                ? mergeActiveModelIfMissing(
                    res.models,
                    row.provider === activeProvider ? currentModel : null,
                  )
                : [];
              const next = new Map(prev);
              next.set(row.provider, { ...(cur ?? { expanded: false }), loading: false, models });
              return next;
            });
          })
          .catch(() => {
            setSections((prev) => {
              const cur = prev.get(row.provider);
              const next = new Map(prev);
              next.set(row.provider, {
                ...(cur ?? { expanded: false }),
                loading: false,
                models: [],
              });
              return next;
            });
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-focus search when any section has models
  const totalModels = useMemo(() => {
    let n = 0;
    for (const s of sections.values()) n += s.models?.length ?? 0;
    return n;
  }, [sections]);

  useEffect(() => {
    if (open && totalModels > MODEL_LIST_SEARCH_THRESHOLD) {
      searchInputRef.current?.focus();
    }
  }, [open, totalModels]);

  const handleTogglePin = useCallback(
    (provider: string, modelId: string, e: import('react').MouseEvent) => {
      e.stopPropagation();
      setPins((prev) => {
        const next = togglePin(prev, provider, modelId);
        savePins(next);
        return next;
      });
    },
    [],
  );

  async function switchModel(provider: string, modelId: string) {
    if (!window.codesign) {
      setOpen(false);
      return;
    }
    if (provider === activeProvider && modelId === currentModel) {
      setOpen(false);
      return;
    }
    try {
      let next: typeof config;
      if (provider !== activeProvider) {
        next = await window.codesign.config.setActiveProviderAndModel({
          provider,
          modelPrimary: modelId,
        });
      } else {
        next = await window.codesign.settings.setActiveProvider({
          provider,
          modelPrimary: modelId,
        });
      }
      recordAction({ type: 'provider.switch', data: { provider, modelId } });
      setConfig(next);
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_MODEL_SAVE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.modelSaveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
        context: { provider, modelId },
      });
    } finally {
      setOpen(false);
    }
  }

  const toggleSection = (provider: string) => {
    setSections((prev) => {
      const cur = prev.get(provider);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(provider, { ...cur, expanded: !cur.expanded });
      return next;
    });
  };

  // Pinned entries filtered by query
  const filteredPins = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return pins;
    return pins.filter(
      (p) => p.modelId.toLowerCase().includes(q) || p.provider.toLowerCase().includes(q),
    );
  }, [pins, query]);

  if (!activeProvider || !currentModel) return null;
  const activeProviderRow = providerRows?.find((r) => r.provider === activeProvider) ?? null;
  const providerLabel = activeProviderRow?.label ?? activeProvider;
  const isSidebar = variant === 'sidebar';

  return (
    <div ref={rootRef} className="relative w-fit">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          isSidebar
            ? 'inline-flex items-center gap-[3px] text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer'
            : 'flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-2_5)] py-[var(--space-1)] select-none hover:bg-[var(--color-surface-hover)] transition-colors'
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {isSidebar ? (
          <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
            {currentModel}
          </span>
        ) : (
          <span className="text-[var(--text-xs)] leading-none flex items-center gap-[6px]">
            <span className="text-[var(--color-text-secondary)]">{providerLabel}</span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span
              className="text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {shortenModelLabel(currentModel)}
            </span>
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isSidebar ? '' : 'text-[var(--color-text-muted)]'}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          className={`absolute z-50 flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-card)] ${
            isSidebar
              ? 'bottom-full mb-[var(--space-1)] left-0 w-[320px]'
              : 'top-full mt-[var(--space-1)] right-0 w-[340px]'
          } max-h-[480px]`}
        >
          {/* Search */}
          <div className="relative p-[var(--space-2)] border-b border-[var(--color-border-muted)] shrink-0">
            <Search
              className="absolute left-[calc(var(--space-2)+var(--space-2))] top-1/2 -translate-y-1/2 w-[13px] h-[13px] text-[var(--color-text-muted)] pointer-events-none"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full h-[28px] pl-[28px] pr-[28px] rounded-[var(--radius-sm)] bg-[var(--color-background-secondary)] border border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus-ring)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear"
                className="absolute right-[calc(var(--space-2)+var(--space-1))] top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <X className="w-[11px] h-[11px]" aria-hidden />
              </button>
            )}
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto flex-1">
            {/* Pinned section */}
            {filteredPins.length > 0 && (
              <div>
                <SectionHeader
                  label="Pinned"
                  icon={<Star className="w-[11px] h-[11px]" />}
                  expanded
                />
                {filteredPins.map((pin) => (
                  <ModelRow
                    key={`pin:${pin.provider}:${pin.modelId}`}
                    modelId={pin.modelId}
                    provider={pin.provider}
                    providerLabel={
                      providerRows?.find((r) => r.provider === pin.provider)?.label ?? pin.provider
                    }
                    isActive={pin.provider === activeProvider && pin.modelId === currentModel}
                    isPinned
                    showProvider
                    onSelect={() => void switchModel(pin.provider, pin.modelId)}
                    onTogglePin={(e) => handleTogglePin(pin.provider, pin.modelId, e)}
                  />
                ))}
              </div>
            )}

            {/* Provider sections */}
            {providerRows === null ? (
              <div className="flex items-center justify-center py-[var(--space-4)]">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
              </div>
            ) : (
              providerRows.map((row) => {
                const sec = sections.get(row.provider);
                const expanded = sec?.expanded ?? row.provider === activeProvider;
                const models = sec?.models ?? null;
                const loading = sec?.loading ?? false;
                const q = query.trim().toLowerCase();
                const filtered = models
                  ? q
                    ? models.filter(
                        (m) =>
                          m.toLowerCase().includes(q) || row.provider.toLowerCase().includes(q),
                      )
                    : models
                  : null;

                // When searching, skip sections with no matches (only if models loaded)
                if (q && filtered && filtered.length === 0) return null;

                return (
                  <div key={row.provider}>
                    <button
                      type="button"
                      onClick={() => toggleSection(row.provider)}
                      className="w-full flex items-center gap-[var(--space-1_5)] px-[var(--space-3)] py-[6px] text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      {expanded ? (
                        <ChevronDown className="w-[11px] h-[11px] shrink-0" aria-hidden />
                      ) : (
                        <ChevronRight className="w-[11px] h-[11px] shrink-0" aria-hidden />
                      )}
                      <span className="flex-1 text-left">{row.label}</span>
                      {loading && <Loader2 className="w-[11px] h-[11px] animate-spin opacity-60" />}
                      {row.isActive && (
                        <span className="text-[10px] font-medium text-[var(--color-accent)] normal-case tracking-normal">
                          active
                        </span>
                      )}
                    </button>

                    {(expanded || q.length > 0) && (
                      <div>
                        {loading ? (
                          <div className="flex justify-center py-[var(--space-2)]">
                            <Loader2 className="w-3 h-3 animate-spin text-[var(--color-text-muted)]" />
                          </div>
                        ) : filtered && filtered.length > 0 ? (
                          filtered.map((m) => (
                            <ModelRow
                              key={`${row.provider}:${m}`}
                              modelId={m}
                              provider={row.provider}
                              providerLabel={row.label}
                              isActive={m === currentModel && row.provider === activeProvider}
                              isPinned={isPinned(pins, row.provider, m)}
                              showProvider={false}
                              onSelect={() => void switchModel(row.provider, m)}
                              onTogglePin={(e) => handleTogglePin(row.provider, m, e)}
                            />
                          ))
                        ) : models !== null ? (
                          <div className="px-[var(--space-3)] py-[var(--space-1_5)] text-[11px] text-[var(--color-text-muted)]">
                            {q ? 'No matches' : t('settings.providers.noModel')}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  icon,
  expanded: _expanded,
}: {
  label: string;
  icon?: import('react').ReactNode;
  expanded?: boolean;
}) {
  return (
    <div className="flex items-center gap-[var(--space-1_5)] px-[var(--space-3)] py-[5px] text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
      {icon}
      {label}
    </div>
  );
}

interface ModelRowProps {
  modelId: string;
  provider: string;
  providerLabel: string;
  isActive: boolean;
  isPinned: boolean;
  showProvider: boolean;
  onSelect: () => void;
  onTogglePin: (e: import('react').MouseEvent) => void;
}

function ModelRow({
  modelId,
  provider: _provider,
  providerLabel,
  isActive,
  isPinned,
  showProvider,
  onSelect,
  onTogglePin,
}: ModelRowProps) {
  return (
    <div
      className={`group relative flex items-center gap-[var(--space-1)] px-[var(--space-3)] pl-[calc(var(--space-3)+var(--space-4))] py-[5px] cursor-pointer transition-colors ${
        isActive ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
      }`}
      onClick={onSelect}
      role="option"
      aria-selected={isActive}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute left-[var(--space-3)] top-[3px] bottom-[3px] w-[2px] rounded-r-full bg-[var(--color-accent)]"
        />
      )}
      <div className="flex-1 min-w-0">
        <div
          className={`text-[12px] truncate font-[ui-monospace,Menlo,monospace] ${isActive ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]'}`}
        >
          {modelId}
        </div>
        {showProvider && (
          <div className="text-[10px] text-[var(--color-text-muted)] truncate">{providerLabel}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onTogglePin}
        aria-label={isPinned ? 'Unpin' : 'Pin'}
        className={`shrink-0 inline-flex items-center justify-center w-[20px] h-[20px] rounded transition-colors ${
          isPinned
            ? 'text-[var(--color-accent)] opacity-100'
            : 'text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100'
        } hover:bg-[var(--color-surface)]`}
      >
        <Star className={`w-[11px] h-[11px] ${isPinned ? 'fill-current' : ''}`} aria-hidden />
      </button>
    </div>
  );
}
