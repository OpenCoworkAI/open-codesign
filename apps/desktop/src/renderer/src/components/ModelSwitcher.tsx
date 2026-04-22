import { useT } from '@open-codesign/i18n';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderRow } from '../../../preload/index';
import { recordAction } from '../lib/action-timeline';
import { useCodesignStore } from '../store';

interface ModelSwitcherProps {
  variant: 'topbar' | 'sidebar';
}

// Below this threshold the search input just adds UI chrome for no real win —
// a user with 6 models can eyeball the list. Above it, scrolling becomes a
// chore (community feedback: providers like DeepSeek/Zhipu return 40+ IDs).
const SEARCH_VISIBILITY_THRESHOLD = 8;

function shortenModelLabel(model: string): string {
  const stripped = model.replace(/^(claude-|gpt-|gemini-)/, '');
  return stripped.includes('/') ? (stripped.split('/').pop() ?? stripped) : stripped;
}

/**
 * Case-insensitive substring filter. Exported for unit tests — inlining it
 * into a useMemo would work, but a pure helper documents the "empty query
 * returns everything" and "trim" rules without reading the component.
 */
export function filterModels(models: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return models;
  return models.filter((m) => m.toLowerCase().includes(q));
}

export function ModelSwitcher({ variant }: ModelSwitcherProps) {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [providerRows, setProviderRows] = useState<ProviderRow[] | null>(null);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const provider = config?.provider ?? null;
  const currentModel = config?.modelPrimary ?? null;

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

  // Reset the filter every time the dropdown closes so the next open starts
  // fresh — otherwise a stale query from a previous session silently hides
  // models and looks like a loading bug.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Load provider rows once — used to display the active provider's friendly label
  useEffect(() => {
    if (providerRows !== null || !window.codesign?.settings?.listProviders) return;
    void window.codesign.settings
      .listProviders()
      .then((rows) => setProviderRows(rows))
      .catch(() => setProviderRows([]));
  }, [providerRows]);

  useEffect(() => {
    if (!open || models !== null || !window.codesign?.models?.listForProvider || !provider) return;
    setLoading(true);
    void window.codesign.models
      .listForProvider(provider)
      .then((res) => setModels(res.ok ? res.models : []))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [open, models, provider]);

  const showSearch = (models?.length ?? 0) > SEARCH_VISIBILITY_THRESHOLD;

  // Auto-focus the search box once the model list arrives so users who
  // opened the dropdown with keyboard don't need to grab the mouse.
  useEffect(() => {
    if (open && showSearch && !loading) {
      searchInputRef.current?.focus();
    }
  }, [open, showSearch, loading]);

  const filteredModels = useMemo(() => {
    if (models === null) return null;
    return filterModels(models, query);
  }, [models, query]);

  if (!provider || !currentModel) return null;

  const activeProviderRow = providerRows?.find((r) => r.provider === provider) ?? null;
  const providerLabel = activeProviderRow?.label ?? provider;

  async function switchModel(model: string) {
    if (!window.codesign || !provider || model === currentModel) {
      setOpen(false);
      return;
    }
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: model,
      });
      recordAction({ type: 'provider.switch', data: { provider, modelId: model } });
      setConfig(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.modelSaveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    } finally {
      setOpen(false);
      setModels(null);
    }
  }

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
          role="listbox"
          className={`absolute z-50 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-card)] ${
            isSidebar
              ? 'bottom-full mb-[var(--space-1)] left-0 min-w-[220px]'
              : 'top-full mt-[var(--space-1)] right-0 min-w-[260px]'
          }`}
        >
          {/* Header — show which provider preset these models belong to */}
          {!isSidebar && (
            <div className="px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-muted)]">
              <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-muted)] font-medium">
                {t('topbar.modelSwitcher.fromProvider', { defaultValue: 'Provider' })}
              </p>
              <p className="text-[12px] text-[var(--color-text-primary)] mt-[2px]">
                {providerLabel}
              </p>
            </div>
          )}

          {showSearch && (
            <div className="relative px-[var(--space-2)] py-[var(--space-1_5)] border-b border-[var(--color-border-muted)]">
              <Search
                className="absolute left-[calc(var(--space-2)+var(--space-2))] top-1/2 -translate-y-1/2 w-[var(--size-icon-xs)] h-[var(--size-icon-xs)] text-[var(--color-text-muted)] pointer-events-none"
                aria-hidden
              />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('topbar.modelSwitcher.searchPlaceholder', {
                  defaultValue: 'Search models…',
                })}
                aria-label={t('topbar.modelSwitcher.searchAriaLabel', {
                  defaultValue: 'Filter models by name',
                })}
                className="w-full h-[var(--size-control-xs)] pl-[calc(var(--space-2)+var(--size-icon-xs)+var(--space-1_5))] pr-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label={t('topbar.modelSwitcher.clearSearch', {
                    defaultValue: 'Clear search',
                  })}
                  className="absolute right-[calc(var(--space-2)+var(--space-1_5))] top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <X className="w-[var(--size-icon-xs)] h-[var(--size-icon-xs)]" aria-hidden />
                </button>
              )}
            </div>
          )}

          <div className="max-h-[280px] overflow-y-auto py-[var(--space-1)]">
            {loading ? (
              <div className="flex items-center justify-center py-[var(--space-3)]">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />
              </div>
            ) : filteredModels && filteredModels.length > 0 ? (
              filteredModels.map((m) => {
                const isActive = m === currentModel;
                return (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => void switchModel(m)}
                    className={`relative w-full text-left px-[var(--space-3)] py-[var(--space-1_5)] text-[12px] transition-colors ${
                      isActive
                        ? 'bg-[var(--color-surface-hover)] font-medium text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                    }`}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-[3px] bottom-[3px] w-[2px] rounded-r-full bg-[var(--color-accent)]"
                      />
                    )}
                    {m}
                  </button>
                );
              })
            ) : models && models.length > 0 && query.trim().length > 0 ? (
              // Had models, filter produced none — distinct copy so the user
              // knows their search term, not the provider, is the reason the
              // list is empty.
              <div className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
                {t('topbar.modelSwitcher.noMatches', {
                  defaultValue: 'No models match "{{query}}"',
                  query: query.trim(),
                })}
              </div>
            ) : (
              <div className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
                {t('settings.providers.noModel')}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
