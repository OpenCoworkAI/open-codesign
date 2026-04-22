import { setLocale as applyLocale, getCurrentLocale, useT } from '@open-codesign/i18n';
import type { OnboardingState, ReasoningLevel, WireApi } from '@open-codesign/shared';
import {
  PROVIDER_SHORTLIST as SHORTLIST,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  Cpu,
  FolderOpen,
  Globe,
  Loader2,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppPaths, Preferences, ProviderRow, StorageKind } from '../../../preload/index';
import { recordAction } from '../lib/action-timeline';
import { useCodesignStore } from '../store';
import { AddCustomProviderModal } from './AddCustomProviderModal';
import { ChatgptLoginCard } from './ChatgptLoginCard';
import { DiagnosticsPanel } from './settings/DiagnosticsPanel';

type Tab = 'models' | 'appearance' | 'storage' | 'diagnostics' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; icon: typeof Cpu }> = [
  { id: 'models', icon: Cpu },
  { id: 'appearance', icon: Palette },
  { id: 'storage', icon: FolderOpen },
  { id: 'diagnostics', icon: AlertCircle },
  { id: 'advanced', icon: Sliders },
];

// ─── Tiny primitives ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)]">
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
      {children}
    </h3>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[var(--color-border-subtle)] last:border-0">
      <div className="min-w-0">
        <Label>{label}</Label>
        {hint && (
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-0.5 leading-[var(--leading-body)]">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`px-3 h-7 rounded-[var(--radius-sm)] text-[var(--text-xs)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            value === opt.value
              ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="appearance-none h-8 pl-3 pr-8 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-[var(--color-text-muted)] pointer-events-none" />
    </div>
  );
}

// ─── Models tab ──────────────────────────────────────────────────────────────

function ProviderOverflowMenu({
  hasError,
  onTestConnection,
  onEdit,
  onDelete,
  label,
}: {
  isActive: boolean;
  hasError: boolean;
  onTestConnection: () => void;
  onEdit: () => void;
  onDelete: () => void;
  label: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function close() {
    setOpen(false);
    setConfirmDelete(false);
  }

  const itemClass =
    'w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors';

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-label={t('settings.providers.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-10 min-w-[10rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] py-1"
        >
          {!hasError && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onTestConnection();
              }}
              className={itemClass}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {t('settings.providers.testConnection')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onEdit();
            }}
            className={itemClass}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('settings.providers.edit')}
          </button>
          {confirmDelete ? (
            <div className="px-2.5 py-1.5 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  close();
                  onDelete();
                }}
                className="h-6 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-error)] hover:opacity-90 transition-opacity"
              >
                {t('settings.providers.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-6 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirmDelete(true)}
              className={`${itemClass} text-[var(--color-error)] hover:text-[var(--color-error)]`}
              aria-label={t('settings.providers.deleteAria', { label })}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('settings.providers.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderCard({
  row,
  config,
  onDelete,
  onActivate,
  onEdit,
  onRowChanged,
}: {
  row: ProviderRow;
  config: OnboardingState | null;
  onDelete: (p: string) => void;
  onActivate: (p: string) => void;
  onEdit: (row: ProviderRow) => void;
  onRowChanged: (row: ProviderRow) => void;
}) {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const label = row.label ?? row.provider;
  const hasError = row.error !== undefined;

  const stateClass = hasError
    ? 'border-[var(--color-error)] bg-[var(--color-surface)]'
    : row.isActive
      ? 'border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface)]';

  async function handleTestConnection() {
    if (!window.codesign) {
      reportableErrorToast({
        code: 'CONNECTION_TEST_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.connectionFailed'),
        description: t('settings.common.unknownError'),
      });
      return;
    }
    try {
      const res = await window.codesign.connection.testProvider(row.provider);
      recordAction({ type: 'connection.test', data: { provider: row.provider, ok: res.ok } });
      if (res.ok) {
        pushToast({ variant: 'success', title: t('settings.providers.toast.connectionOk') });
      } else {
        reportableErrorToast({
          code: 'CONNECTION_TEST_FAILED',
          scope: 'settings',
          title: t('settings.providers.toast.connectionFailed'),
          description: res.hint || res.message,
          context: { provider: row.provider },
        });
      }
    } catch (err) {
      reportableErrorToast({
        code: 'CONNECTION_TEST_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.connectionFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
        context: { provider: row.provider },
      });
    }
  }

  return (
    <div
      className={`rounded-[var(--radius-lg)] border px-[var(--space-3)] py-[var(--space-2_5)] transition-colors ${stateClass}`}
    >
      <div className="flex items-center gap-[var(--space-3)]">
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          {hasError ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--font-size-badge)] font-medium leading-none">
              <AlertTriangle className="w-2.5 h-2.5" />
              {t('settings.providers.decryptionFailed')}
            </span>
          ) : row.hasKey === false ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[var(--color-warning,_#d97706)] text-[var(--color-warning,_#d97706)] text-[var(--font-size-badge)] font-medium leading-none">
              <AlertTriangle className="w-2.5 h-2.5" />
              {t('settings.providers.missingKey')}
            </span>
          ) : null}
          {row.baseUrl && (
            <span className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] min-w-0">
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate">{row.baseUrl}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {row.isActive && !hasError && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent text-[var(--font-size-badge)] font-medium leading-none">
              {t('settings.providers.active')}
            </span>
          )}
          {!row.isActive && !hasError && row.hasKey !== false && (
            <button
              type="button"
              onClick={() => onActivate(row.provider)}
              className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('settings.providers.setActive')}
            </button>
          )}
          <ProviderOverflowMenu
            isActive={row.isActive}
            hasError={hasError}
            onTestConnection={handleTestConnection}
            onEdit={() => onEdit(row)}
            onDelete={() => onDelete(row.provider)}
            label={label}
          />
        </div>
      </div>

      {!hasError && row.hasKey !== false && config !== null && (
        <RowModelSelector config={config} row={row} onRowChanged={onRowChanged} />
      )}
      {!hasError && row.hasKey !== false && (
        <ReasoningDepthSelector
          provider={row.provider}
          value={row.reasoningLevel}
          onUpdated={onRowChanged}
        />
      )}
    </div>
  );
}

function RowModelSelector({
  config,
  row,
  onRowChanged,
}: {
  config: OnboardingState;
  row: ProviderRow;
  onRowChanged: (row: ProviderRow) => void;
}) {
  const t = useT();
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);

  const provider = row.provider;
  const isActive = row.isActive;

  const initial = isActive
    ? (config.modelPrimary ?? row.defaultModel ?? '')
    : (row.defaultModel ?? '');
  const [primary, setPrimary] = useState(initial);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setPrimary(
      isActive ? (config.modelPrimary ?? row.defaultModel ?? '') : (row.defaultModel ?? ''),
    );
  }, [isActive, config.modelPrimary, row.defaultModel]);

  // Fetch models immediately on mount
  useEffect(() => {
    if (!window.codesign?.models?.listForProvider) return;
    let cancelled = false;
    setLoadingModels(true);
    void window.codesign.models.listForProvider(provider).then((res) => {
      if (cancelled) return;
      setLoadingModels(false);
      setModels(res.ok ? res.models : []);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const saveSeq = useRef(0);

  async function save(next: string): Promise<boolean> {
    if (!window.codesign) return false;
    try {
      if (isActive) {
        const updated = await window.codesign.settings.setActiveProvider({
          provider,
          modelPrimary: next,
        });
        recordAction({ type: 'provider.switch', data: { provider, modelId: next } });
        setConfig(updated);
      } else {
        // Inactive row: persist the per-provider default so that clicking
        // "Set as current" later picks it up (see handleActivate → currentRow.defaultModel).
        await window.codesign.config.updateProvider({ id: provider, defaultModel: next });
        onRowChanged({ ...row, defaultModel: next });
      }
      return true;
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_MODEL_SAVE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.modelSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
        context: { provider },
      });
      return false;
    }
  }

  function handleChange(v: string) {
    const prev = primary;
    const seq = ++saveSeq.current;
    setPrimary(v);
    void save(v).then((ok) => {
      if (!ok && seq === saveSeq.current) setPrimary(prev);
    });
  }

  const notInListSuffix = t('settings.providers.activeNotInList');
  const options = useMemo(
    () =>
      computeModelOptions({
        models,
        activeModelId: isActive ? primary : null,
        notInListSuffix,
      }),
    [models, isActive, primary, notInListSuffix],
  );

  return (
    <div className="mt-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
      <Cpu className="w-3 h-3 shrink-0" />
      {loadingModels ? (
        <span className="inline-flex items-center gap-1 h-6 px-2 text-[var(--text-xs)]">
          <Loader2 className="w-3 h-3 animate-spin" />
        </span>
      ) : options !== null ? (
        <NativeSelect value={primary} onChange={handleChange} options={options} />
      ) : (
        <span className="h-6 px-2 inline-flex items-center font-mono text-[var(--text-xs)] text-[var(--color-text-primary)]">
          {primary || t('settings.providers.noModel')}
        </span>
      )}
    </div>
  );
}

type ReasoningOption = '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

function ReasoningDepthSelector({
  provider,
  value,
  onUpdated,
}: {
  provider: string;
  value: ReasoningLevel | undefined;
  onUpdated: (row: ProviderRow) => void;
}) {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const [saving, setSaving] = useState(false);
  // Controlled local state — optimistic so the dropdown reflects the user's
  // choice immediately, before the IPC round-trip resolves. Without this,
  // the <select> re-renders from the stale `value` prop and snaps back to
  // the previous level the instant the user picks a new one.
  const [current, setCurrent] = useState<ReasoningOption>(value ?? '');
  useEffect(() => {
    setCurrent(value ?? '');
  }, [value]);
  const saveSeq = useRef(0);

  async function handleChange(next: ReasoningOption) {
    if (!window.codesign?.config?.updateProvider) return;
    const prev = current;
    const seq = ++saveSeq.current;
    setCurrent(next); // optimistic
    setSaving(true);
    try {
      // '' means "clear the per-provider override and fall back to the
      // model-family default"; any other string is an explicit set.
      const payload = { id: provider, reasoningLevel: next === '' ? null : next } as const;
      await window.codesign.config.updateProvider(payload);
      pushToast({ variant: 'success', title: t('settings.providers.toast.reasoningSaved') });
      if (window.codesign?.settings?.listProviders) {
        const rows = await window.codesign.settings.listProviders();
        const row = rows.find((r) => r.provider === provider);
        if (row) onUpdated(row);
      }
    } catch (err) {
      // Roll back the optimistic update only if this is still the latest
      // in-flight save — otherwise a newer pick is about to land.
      if (seq === saveSeq.current) setCurrent(prev);
      reportableErrorToast({
        code: 'PROVIDER_REASONING_SAVE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.reasoningSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
        context: { provider },
      });
    } finally {
      if (seq === saveSeq.current) setSaving(false);
    }
  }

  const options: Array<{ value: ReasoningOption; label: string }> = [
    { value: '', label: t('settings.providers.reasoning.default') },
    { value: 'minimal', label: t('settings.providers.reasoning.minimal') },
    { value: 'low', label: t('settings.providers.reasoning.low') },
    { value: 'medium', label: t('settings.providers.reasoning.medium') },
    { value: 'high', label: t('settings.providers.reasoning.high') },
    { value: 'xhigh', label: t('settings.providers.reasoning.xhigh') },
  ];

  return (
    <div className="mt-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
      <Sliders className="w-3 h-3 shrink-0" />
      <span>{t('settings.providers.reasoning.label')}</span>
      <NativeSelect
        value={current}
        onChange={(v) => void handleChange(v as ReasoningOption)}
        options={options}
        disabled={saving}
      />
    </div>
  );
}

/**
 * Keep in sync with `PARSE_REASON_NOT_JSON_OBJECT` in
 * apps/desktop/src/main/imports/claude-code-config.ts. The renderer can't
 * import main-process modules, so the sentinel is duplicated rather than
 * exposed via a preload bridge for one constant string.
 */
const PARSE_REASON_NOT_JSON_OBJECT = '__parse_reason_not_json_object__';

const DISMISSED_BANNER_PREFIX = 'open-codesign:settings:dismissed-import-banner:';

/**
 * Electron IPC wraps thrown errors as
 * `Error invoking remote method '<channel>': <ErrorName>: <message>`.
 * Strip the wrapper and, for bilingual messages formatted as `en / zh`,
 * pick the side matching the active locale so toast descriptions read
 * like natural sentences instead of framework tracebacks.
 */
function cleanIpcError(err: unknown): string {
  if (!(err instanceof Error)) return String(err ?? '');
  const raw = err.message;
  const stripped = raw.replace(/^Error invoking remote method '[^']*':\s*[A-Za-z]*Error:\s*/, '');
  const parts = stripped.split(' / ');
  if (parts.length >= 2) {
    return getCurrentLocale() === 'zh-CN' ? (parts[1] ?? stripped) : (parts[0] ?? stripped);
  }
  return stripped;
}

/**
 * Strip any user:pass@ credentials from a URL before putting it into
 * visible copy (banner, toast, screenshot). Preserves the full URL for
 * anything the renderer passes back into the modal preset — we don't want
 * to silently change what will be saved, only what's shown to the user.
 * Falls back to the raw string on parse failure.
 */
function maskBaseUrlCreds(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username === '' && u.password === '') return raw;
    u.username = '';
    u.password = '';
    // URL.toString() always appends a trailing slash on bare-host URLs.
    // Preserve the input's original slash/no-slash shape so
    // `https://proxy.local` round-trips unchanged — only the credentials
    // get stripped.
    return u.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '');
  } catch {
    return raw;
  }
}

function readDismissed(kind: 'codex' | 'claudeCode' | 'gemini' | 'opencode'): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_BANNER_PREFIX + kind) === '1';
  } catch {
    return false;
  }
}
function writeDismissed(kind: 'codex' | 'claudeCode' | 'gemini' | 'opencode'): void {
  try {
    window.localStorage.setItem(DISMISSED_BANNER_PREFIX + kind, '1');
  } catch {
    // localStorage may be unavailable in tests; non-fatal
  }
}

function ImportBanner({
  label,
  onImport,
  onDismiss,
  actionLabel,
  tone = 'accent',
}: {
  label: string;
  /** Omit to render a warning-only banner with no import button (Vertex AI
   *  / Gemini-without-key cases that just need a dismissable note). */
  onImport?: () => void;
  onDismiss: () => void;
  actionLabel?: string;
  tone?: 'accent' | 'info';
}) {
  const t = useT();
  // Accent = green (Type B: import ready). Info = neutral blue (Type C: needs finishing).
  const toneClasses =
    tone === 'info'
      ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]'
      : 'border-[var(--color-accent)] bg-[var(--color-accent-tint)]';
  return (
    <div
      className={`rounded-[var(--radius-md)] border ${toneClasses} px-3 py-2 flex items-center gap-2`}
    >
      <span className="flex-1 text-[var(--text-xs)] text-[var(--color-text-primary)]">{label}</span>
      {onImport !== undefined && (
        <button
          type="button"
          onClick={onImport}
          className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          {actionLabel ?? t('settings.providers.import.action')}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
      >
        {t('settings.providers.import.dismiss')}
      </button>
    </div>
  );
}

/**
 * Full-width multi-line banner for the OAuth-subscription case — users who
 * logged into Claude Code via Pro/Max OAuth and cannot share that quota
 * with third-party apps. Renders the "why it won't work" explainer plus
 * two CTAs: go grab an API key, or paste one the user already has.
 */
function OAuthSubscriptionBanner({
  onDismiss,
  onIHaveKey,
}: {
  onDismiss: () => void;
  onIHaveKey: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-3 space-y-2">
      <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
        {t('settings.providers.import.claudeCodeOAuthTitle')}
      </div>
      <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-relaxed">
        {t('settings.providers.import.claudeCodeOAuthBody')}
      </p>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-relaxed">
        {t('settings.providers.import.claudeCodeShellEnvHint')}
      </p>
      {/* One action row. The two CTAs live in an inner `flex-1` wrapper so
          Dismiss is pushed to the right on wide windows (ml-auto effect via
          flex sizing) but wraps to its own line beneath them on narrow
          windows — where "dismiss on the right while CTAs are on the left"
          would read as a layout glitch. DOM order is primary → secondary →
          dismiss so keyboard Tab still lands on the real actions first. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 inline-flex items-center rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {t('settings.providers.import.claudeCodeOAuthCtaConsole')}
          </a>
          <button
            type="button"
            onClick={onIHaveKey}
            className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
          >
            {t('settings.providers.import.claudeCodeIHaveKey')}
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
        >
          {t('settings.providers.import.dismiss')}
        </button>
      </div>
    </div>
  );
}

/**
 * Banner shown when ~/.claude/settings.json exists but can't be parsed
 * (invalid JSON / wrong shape). We surface the file path so the user can
 * open and fix it — we deliberately don't launch the OS file opener to
 * avoid the file-association guesswork and the "Which app?" prompt.
 */
function ParseErrorBanner({
  reason,
  path,
  onCopyPath,
  onDismiss,
}: {
  reason: string;
  path: string;
  onCopyPath: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-error)] bg-[var(--color-surface-muted)] p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-error)]"
          aria-hidden="true"
        />
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
          {t('settings.providers.import.claudeCodeParseErrorTitle')}
        </div>
      </div>
      <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-relaxed break-words">
        {t('settings.providers.import.claudeCodeParseErrorBody', { reason })}
      </p>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono break-all">
        {path}
      </p>
      <div className="flex justify-between items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCopyPath}
          className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
        >
          {t('settings.providers.import.claudeCodeParseErrorCopyPath')}
        </button>
        {/* Dismiss last in DOM — see OAuthSubscriptionBanner rationale. */}
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
        >
          {t('settings.providers.import.dismiss')}
        </button>
      </div>
    </div>
  );
}

/**
 * Muted one-liners rendered under a banner. Each entry is a parser-emitted
 * warning (e.g. "apiKeyHelper detected, not executed"). Line-clamped so a
 * single pathological warning can't own three screens; capped to 3 items
 * with a "+N more" disclosure when more pile up.
 */
function WarningsList({ warnings }: { warnings: string[] }) {
  const t = useT();
  if (warnings.length === 0) return null;
  const MAX = 3;
  const shown = warnings.slice(0, MAX);
  const overflow = warnings.length - shown.length;
  return (
    <ul className="space-y-1 pl-1 pt-1">
      {shown.map((w, i) => (
        // Index-qualified key so two byte-identical warnings don't collide.
        // eslint-disable-next-line react/no-array-index-key
        <li
          key={`${i}-${w.slice(0, 32)}`}
          className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-relaxed break-words line-clamp-2"
        >
          ⚠️ {w}
        </li>
      ))}
      {overflow > 0 ? (
        <li className="text-[var(--text-xs)] text-[var(--color-text-muted)] italic">
          {t('settings.providers.import.claudeCodeWarningsMore', { count: overflow })}
        </li>
      ) : null}
    </ul>
  );
}

function ModelsTab() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [externalConfigs, setExternalConfigs] = useState<{
    codex?: { count: number } | undefined;
    claudeCode?:
      | {
          userType: 'has-api-key' | 'oauth-only' | 'local-proxy' | 'remote-gateway' | 'parse-error';
          baseUrl: string;
          defaultModel: string;
          apiKeySource: 'settings-json' | 'shell-env' | 'none';
          hasApiKey: boolean;
          settingsPath: string;
          warnings: string[];
        }
      | undefined;
    gemini?:
      | {
          hasApiKey: boolean;
          apiKeySource: 'gemini-env' | 'home-env' | 'shell-env' | 'none';
          keyPath: string | null;
          warnings: string[];
          blocked: boolean;
        }
      | undefined;
    opencode?:
      | { count: number; providerLabels: string[]; warnings: string[]; blocked: boolean }
      | undefined;
  } | null>(null);
  /**
   * When set, `AddCustomProviderModal` mounts with these fields pre-filled.
   * Used by the OAuth "I have an API key" path to jump the user straight
   * to a pre-configured Anthropic entry instead of the generic form, and
   * by the local-proxy / remote-gateway paths to pre-fill the detected
   * endpoint so the user only has to paste a key.
   */
  const [customProviderPreset, setCustomProviderPreset] = useState<
    | {
        name: string;
        baseUrl: string;
        wire: WireApi;
        defaultModel?: string;
      }
    | undefined
  >(undefined);
  /** Open AddCustomProviderModal in edit-mode against this row. Works for
   *  both builtin and custom providers; builtins get their endpoint fields
   *  locked so users can't accidentally break them. */
  const [editingRow, setEditingRow] = useState<ProviderRow | null>(null);

  function handleEdit(row: ProviderRow) {
    setEditingRow(row);
  }

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .listProviders()
      .then(setRows)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.providers.toast.loadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      })
      .finally(() => setLoading(false));
    void window.codesign.config
      .detectExternalConfigs()
      .then((detected) => {
        const dismissedCodex = readDismissed('codex');
        const dismissedClaudeCode = readDismissed('claudeCode');
        const dismissedGemini = readDismissed('gemini');
        const dismissedOpencode = readDismissed('opencode');
        const surface =
          detected.claudeCode !== undefined &&
          detected.claudeCode.userType !== 'no-config' &&
          !dismissedClaudeCode;
        setExternalConfigs({
          ...(detected.codex !== undefined && !dismissedCodex
            ? { codex: { count: detected.codex.providers.length } }
            : {}),
          ...(surface && detected.claudeCode !== undefined
            ? {
                claudeCode: {
                  userType: detected.claudeCode.userType as
                    | 'has-api-key'
                    | 'oauth-only'
                    | 'local-proxy'
                    | 'remote-gateway'
                    | 'parse-error',
                  baseUrl: detected.claudeCode.baseUrl,
                  defaultModel: detected.claudeCode.defaultModel,
                  apiKeySource: detected.claudeCode.apiKeySource,
                  hasApiKey: detected.claudeCode.hasApiKey,
                  settingsPath: detected.claudeCode.settingsPath,
                  warnings: detected.claudeCode.warnings ?? [],
                },
              }
            : {}),
          ...(detected.gemini !== undefined && !dismissedGemini
            ? {
                gemini: {
                  hasApiKey: detected.gemini.hasApiKey,
                  apiKeySource: detected.gemini.apiKeySource,
                  keyPath: detected.gemini.keyPath,
                  warnings: detected.gemini.warnings ?? [],
                  blocked: detected.gemini.blocked,
                },
              }
            : {}),
          ...(detected.opencode !== undefined && !dismissedOpencode
            ? {
                opencode: {
                  count: detected.opencode.providers.length,
                  // Preserve the "OpenCode · Anthropic" style labels so the
                  // banner can show the user WHICH providers will be
                  // imported, not just a bare count.
                  providerLabels: detected.opencode.providers.map((p) => p.name),
                  warnings: detected.opencode.warnings ?? [],
                  blocked: detected.opencode.blocked,
                },
              }
            : {}),
        });
      })
      .catch(() => {
        // non-fatal; banner just doesn't appear
      });
  }, [pushToast, t]);

  async function reloadRows() {
    if (!window.codesign) return;
    const [nextRows, state] = await Promise.all([
      window.codesign.settings.listProviders(),
      window.codesign.onboarding.getState(),
    ]);
    setRows(nextRows);
    setConfig(state);
  }

  async function handleImportCodex() {
    if (!window.codesign) return;
    try {
      await window.codesign.config.importCodexConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, codex: undefined }));
      await reloadRows();
      pushToast({ variant: 'success', title: t('settings.providers.import.codexDone') });
    } catch (err) {
      reportableErrorToast({
        code: 'CODEX_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleAddOllama() {
    if (!window.codesign) return;
    try {
      await window.codesign.settings.addProvider({
        provider: 'ollama',
        apiKey: '',
        modelPrimary: SHORTLIST.ollama.defaultPrimary,
      });
      await reloadRows();
      pushToast({ variant: 'success', title: t('settings.providers.import.ollamaDone') });
    } catch (err) {
      reportableErrorToast({
        code: 'OLLAMA_ADD_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.saveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportGemini() {
    if (!window.codesign) return;
    // Capture pre-import warnings (e.g. "AIzaSy pattern mismatch") so a
    // soft-validation failure surfaces in the toast description instead
    // of silently shipping an invalid key the user will only discover on
    // first request.
    const geminiWarnings = externalConfigs?.gemini?.warnings ?? [];
    try {
      await window.codesign.config.importGeminiConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, gemini: undefined }));
      await reloadRows();
      const description =
        geminiWarnings.length > 0 ? geminiWarnings.slice(0, 2).join('\n') : undefined;
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.geminiDone'),
        ...(description !== undefined ? { description } : {}),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'GEMINI_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportOpencode() {
    if (!window.codesign) return;
    // Capture pre-import warnings: OpenCode commonly has OAuth entries that
    // we skip, and without surfacing those reasons the user sees "imported
    // 3 providers" success toast but the other 2 entries vanish silently.
    const skippedSummary = externalConfigs?.opencode?.warnings ?? [];
    try {
      await window.codesign.config.importOpencodeConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, opencode: undefined }));
      await reloadRows();
      const description =
        skippedSummary.length > 0
          ? skippedSummary.slice(0, 3).join('\n') +
            (skippedSummary.length > 3 ? `\n+${skippedSummary.length - 3} more` : '')
          : undefined;
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.opencodeDone'),
        ...(description !== undefined ? { description } : {}),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'OPENCODE_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportClaudeCode() {
    if (!window.codesign) return;
    // Only `has-api-key` reaches here; other userTypes open the paste
    // modal via a preset instead of hitting the silent-import IPC.
    try {
      await window.codesign.config.importClaudeCodeConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, claudeCode: undefined }));
      await reloadRows();
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.claudeCodeImportedActivated'),
      });
    } catch (err) {
      // Safety net for a stale detection → OAuth-only race (settings.json
      // lost its key between mount and click).
      const code = (err as { code?: string } | null)?.code;
      if (code === 'CLAUDE_CODE_OAUTH_ONLY') {
        pushToast({
          variant: 'info',
          title: t('settings.providers.import.oauthErrorToast'),
          // Make the toast self-sufficient: referencing "the banner above"
          // is a dead end if the user has dismissed it. Action opens the
          // Anthropic console in the default browser so the user can grab
          // a key without going back to the banner at all.
          action: {
            label: t('settings.providers.import.oauthErrorToastCta'),
            onClick: () => {
              window.open('https://console.anthropic.com/settings/keys', '_blank');
            },
          },
        });
        return;
      }
      reportableErrorToast({
        code: 'CLAUDECODE_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleCopyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.claudeCodeParseErrorPathCopied'),
      });
    } catch {
      pushToast({
        variant: 'error',
        title: t('settings.common.unknownError'),
        description: path,
      });
    }
  }

  async function handleDelete(provider: string) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.deleteProvider(provider);
      setRows(next);
      const newState = await window.codesign.onboarding.getState();
      setConfig(newState);
      pushToast({ variant: 'success', title: t('settings.providers.toast.removed') });
      // If the user deleted the claude-code-imported row, re-run detection
      // so the banner can reappear (otherwise alreadyHasClaudeCode from the
      // initial mount would keep it suppressed for the rest of the session).
      if (provider === 'claude-code-imported') {
        try {
          const detected = await window.codesign.config.detectExternalConfigs();
          const detectedCc = detected.claudeCode;
          const dismissedClaudeCode = readDismissed('claudeCode');
          if (
            detectedCc !== undefined &&
            detectedCc.userType !== 'no-config' &&
            !dismissedClaudeCode
          ) {
            setExternalConfigs((prev) => ({
              ...(prev ?? {}),
              claudeCode: {
                userType: detectedCc.userType as
                  | 'has-api-key'
                  | 'oauth-only'
                  | 'local-proxy'
                  | 'remote-gateway'
                  | 'parse-error',
                baseUrl: detectedCc.baseUrl,
                defaultModel: detectedCc.defaultModel,
                apiKeySource: detectedCc.apiKeySource,
                hasApiKey: detectedCc.hasApiKey,
                settingsPath: detectedCc.settingsPath,
                warnings: detectedCc.warnings ?? [],
              },
            }));
          }
        } catch {
          /* non-fatal: banner just won't reappear this session */
        }
      }
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_DELETE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.deleteFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleActivate(provider: string) {
    if (!window.codesign) return;
    const sl = isSupportedOnboardingProvider(provider) ? SHORTLIST[provider] : null;
    const currentRow = rows.find((r) => r.provider === provider);
    const defaultModel =
      currentRow?.defaultModel || sl?.defaultPrimary || config?.modelPrimary || '';
    const label = sl?.label ?? currentRow?.label ?? provider;
    if (defaultModel.length === 0) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.activateFailed'),
        description: t('settings.providers.toast.missingModel'),
      });
      return;
    }
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: defaultModel,
      });
      recordAction({
        type: 'provider.switch',
        data: { provider, modelId: defaultModel },
      });
      setConfig(next);
      const updatedRows = await window.codesign.settings.listProviders();
      setRows(updatedRows);
      pushToast({
        variant: 'success',
        title: t('settings.providers.toast.switchedTo', { label }),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_ACTIVATE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.switchFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  return (
    <>
      {showAddCustom && (
        <AddCustomProviderModal
          onSave={async () => {
            // If this save came from a Claude Code banner flow (preset set),
            // clear the banner — the provider it was nagging about is now
            // successfully imported. Otherwise leave externalConfigs alone.
            const cameFromClaudeCodeBanner = customProviderPreset !== undefined;
            setShowAddCustom(false);
            setCustomProviderPreset(undefined);
            if (cameFromClaudeCodeBanner) {
              setExternalConfigs((prev) =>
                prev === null ? null : { ...prev, claudeCode: undefined },
              );
            }
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => {
            setShowAddCustom(false);
            setCustomProviderPreset(undefined);
          }}
          {...(customProviderPreset !== undefined ? { initialValues: customProviderPreset } : {})}
        />
      )}

      {editingRow !== null && (
        <AddCustomProviderModal
          onSave={async () => {
            setEditingRow(null);
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => setEditingRow(null)}
          editTarget={{
            id: editingRow.provider,
            name: editingRow.name,
            baseUrl: editingRow.baseUrl ?? '',
            wire: editingRow.wire,
            defaultModel: editingRow.defaultModel,
            builtin: editingRow.builtin,
            lockEndpoint: editingRow.builtin,
            ...(editingRow.maskedKey.length > 0 ? { keyMask: editingRow.maskedKey } : {}),
          }}
          initialSetAsActive={false}
        />
      )}

      <div className="space-y-[var(--space-3)]">
        <ChatgptLoginCard onStatusChange={reloadRows} />
        {externalConfigs !== null &&
          (externalConfigs.codex !== undefined ||
            externalConfigs.claudeCode !== undefined ||
            externalConfigs.gemini !== undefined ||
            externalConfigs.opencode !== undefined) && (
            <div className="space-y-2">
              {externalConfigs.codex !== undefined && (
                <ImportBanner
                  label={t('settings.providers.import.codexFound', {
                    count: externalConfigs.codex.count,
                  })}
                  onImport={handleImportCodex}
                  onDismiss={() => {
                    writeDismissed('codex');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, codex: undefined },
                    );
                  }}
                />
              )}
              {externalConfigs.opencode !== undefined &&
                (() => {
                  const oc = externalConfigs.opencode;
                  const dismiss = () => {
                    writeDismissed('opencode');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, opencode: undefined },
                    );
                  };
                  if (oc.blocked) {
                    // Corrupt auth.json / all OAuth / all unsupported —
                    // surface what we saw so the user doesn't think nothing
                    // was detected. No import button because there's
                    // nothing importable.
                    return (
                      <ImportBanner
                        label={oc.warnings[0] ?? t('settings.providers.import.opencodeBlocked')}
                        onDismiss={dismiss}
                      />
                    );
                  }
                  // First 3 provider labels inline, then "+N more" for
                  // the overflow. Keeps the banner one-line even for a
                  // user with 7 keys configured in opencode.
                  const head = oc.providerLabels.slice(0, 3).join(', ');
                  const overflow = oc.providerLabels.length - 3;
                  const providerSummary = overflow > 0 ? `${head} +${overflow} more` : head;
                  return (
                    <ImportBanner
                      label={t('settings.providers.import.opencodeFound', {
                        count: oc.count,
                        providers: providerSummary,
                      })}
                      onImport={handleImportOpencode}
                      onDismiss={dismiss}
                    />
                  );
                })()}
              {externalConfigs.gemini !== undefined &&
                (() => {
                  const g = externalConfigs.gemini;
                  const dismiss = () => {
                    writeDismissed('gemini');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, gemini: undefined },
                    );
                  };
                  if (g.blocked) {
                    // Vertex AI (or other non-importable Gemini setup).
                    // Render a warning-only banner — no import button.
                    return (
                      <ImportBanner
                        label={g.warnings[0] ?? t('settings.providers.import.geminiBlocked')}
                        onDismiss={dismiss}
                      />
                    );
                  }
                  const label = g.hasApiKey
                    ? t('settings.providers.import.geminiFound')
                    : t('settings.providers.import.geminiNoKey');
                  return (
                    <ImportBanner
                      label={label}
                      {...(g.hasApiKey ? { onImport: handleImportGemini } : {})}
                      onDismiss={dismiss}
                    />
                  );
                })()}
              {externalConfigs.claudeCode !== undefined &&
                (() => {
                  const cc = externalConfigs.claudeCode;
                  // Mask any user:pass@ credentials before putting the URL
                  // into visible copy. Keeps the preset's raw form intact so
                  // the user's proxy still works at runtime.
                  const displayBaseUrl = maskBaseUrlCreds(cc.baseUrl);
                  const dismiss = () => {
                    writeDismissed('claudeCode');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, claudeCode: undefined },
                    );
                  };
                  const openAnthropicPaste = () => {
                    setCustomProviderPreset({
                      name: t('settings.providers.import.claudeCodeAnthropicPresetName'),
                      baseUrl: 'https://api.anthropic.com',
                      wire: 'anthropic',
                      defaultModel: 'claude-sonnet-4-6',
                    });
                    setShowAddCustom(true);
                    // Banner stays visible: if the user cancels the modal
                    // they still need the reminder.
                  };
                  // Proxy / remote gateway: same paste flow but pre-fill the
                  // detected baseUrl + model. Wire stays anthropic since these
                  // endpoints speak Anthropic's Messages API. Users can still
                  // edit every field before saving.
                  const openGatewayPaste = (presetName: string) => {
                    setCustomProviderPreset({
                      name: presetName,
                      baseUrl: cc.baseUrl,
                      wire: 'anthropic',
                      defaultModel: cc.defaultModel,
                    });
                    setShowAddCustom(true);
                    // Same rationale as openAnthropicPaste: banner stays
                    // in case user cancels out of the modal.
                  };

                  if (cc.userType === 'parse-error') {
                    // Translate the sentinel before feeding the banner
                    // template. V8's JSON.parse errors are English-only so
                    // they pass through as-is; only our app-authored
                    // "not an object" signal gets localized.
                    const rawReason = cc.warnings[0] ?? '';
                    const reason =
                      rawReason === PARSE_REASON_NOT_JSON_OBJECT
                        ? t('settings.providers.import.claudeCodeParseErrorReasonNotObject')
                        : rawReason || t('settings.common.unknownError');
                    return (
                      <>
                        <ParseErrorBanner
                          reason={reason}
                          path={cc.settingsPath}
                          onCopyPath={() => handleCopyPath(cc.settingsPath)}
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings.slice(1)} />
                      </>
                    );
                  }
                  if (cc.userType === 'oauth-only') {
                    return (
                      <>
                        <OAuthSubscriptionBanner
                          onDismiss={dismiss}
                          onIHaveKey={openAnthropicPaste}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  if (cc.userType === 'has-api-key') {
                    const source =
                      cc.apiKeySource === 'shell-env'
                        ? t('settings.providers.import.claudeCodeHasKeySourceEnv')
                        : t('settings.providers.import.claudeCodeHasKeySourceSettings');
                    return (
                      <>
                        <ImportBanner
                          label={t('settings.providers.import.claudeCodeHasKeyBody', {
                            source,
                            baseUrl: displayBaseUrl,
                          })}
                          onImport={handleImportClaudeCode}
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  if (cc.userType === 'local-proxy') {
                    return (
                      <>
                        <ImportBanner
                          tone="info"
                          label={t('settings.providers.import.claudeCodeLocalProxyBody', {
                            baseUrl: displayBaseUrl,
                          })}
                          actionLabel={t('settings.providers.import.claudeCodeLocalProxyAction')}
                          onImport={() =>
                            openGatewayPaste(
                              t('settings.providers.import.claudeCodeLocalProxyPresetName'),
                            )
                          }
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  // remote-gateway
                  return (
                    <>
                      <ImportBanner
                        tone="info"
                        label={t('settings.providers.import.claudeCodeRemoteGatewayBody', {
                          baseUrl: displayBaseUrl,
                        })}
                        actionLabel={t('settings.providers.import.claudeCodeRemoteGatewayAction')}
                        onImport={() =>
                          openGatewayPaste(
                            t('settings.providers.import.claudeCodeRemoteGatewayPresetName'),
                          )
                        }
                        onDismiss={dismiss}
                      />
                      <WarningsList warnings={cc.warnings} />
                    </>
                  );
                })()}
            </div>
          )}
        <div className="flex items-center justify-between gap-[var(--space-3)] min-h-[var(--size-control-sm)]">
          <SectionTitle>{t('settings.providers.sectionTitle')}</SectionTitle>
          <AddProviderMenu
            open={showAddMenu}
            setOpen={setShowAddMenu}
            hasClaudeCodeImported={rows.some((r) => r.provider === 'claude-code-imported')}
            hasOllamaImported={rows.some((r) => r.provider === 'ollama')}
            onImportCodex={() => {
              setShowAddMenu(false);
              void handleImportCodex();
            }}
            onImportClaudeCode={() => {
              setShowAddMenu(false);
              void handleImportClaudeCode();
            }}
            onAddOllama={() => {
              setShowAddMenu(false);
              void handleAddOllama();
            }}
            onAddCustom={() => {
              setShowAddMenu(false);
              setShowAddCustom(true);
            }}
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('settings.common.loading')}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
            {t('settings.providers.empty')}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <ProviderCard
                key={row.provider}
                row={row}
                config={config}
                onDelete={handleDelete}
                onActivate={handleActivate}
                onEdit={handleEdit}
                onRowChanged={(next) =>
                  setRows((prev) => prev.map((r) => (r.provider === next.provider ? next : r)))
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Appearance tab ───────────────────────────────────────────────────────────

/**
 * Applies a locale change end-to-end:
 *   1. Persists it via the IPC bridge (writes to disk on the main process)
 *   2. Changes the active i18next language so React components re-render
 *
 * Requires a connected `localeApi` — callers must guard against a missing
 * bridge before invoking this function.
 *
 * Exported so it can be unit-tested without a DOM.
 */
export async function applyLocaleChange(
  locale: string,
  localeApi: { set: (locale: string) => Promise<string> },
): Promise<string> {
  const persisted = await localeApi.set(locale);
  const applied = await applyLocale(persisted);
  return applied;
}

/**
 * Build the <select> options for the active-provider model dropdown.
 *
 * The /models endpoint may return a partial list (or none at all), and the
 * active model id may have been set via TOML import or a previous list that
 * the gateway no longer returns. If the active id is not in `models`, the
 * native <select> would silently fall back to options[0] and lie about which
 * model is in use (issue #136). Pin the active id at the top with a hint so
 * the UI always matches reality.
 *
 * Returns null when there is nothing to render (loading completed, no models,
 * no active id) so the caller can fall back to a plain text label.
 */
export function computeModelOptions(input: {
  models: string[] | null;
  activeModelId: string | null;
  notInListSuffix: string;
}): { value: string; label: string }[] | null {
  const { models, activeModelId, notInListSuffix } = input;
  if (models === null || models.length === 0) return null;
  const base = models.map((m) => ({ value: m, label: m }));
  if (activeModelId && !models.includes(activeModelId)) {
    return [{ value: activeModelId, label: `${activeModelId} ${notInListSuffix}` }, ...base];
  }
  return base;
}

/**
 * Canonical timeout choices shown in Settings → Advanced. The default prefs
 * value is 1200s (20 min); long generations (full PDP runs) need 30-60 min,
 * so the dropdown tops out at 2h. The old 60-300s ceiling silently clamped
 * the stored value when the UI couldn't represent it.
 */
export const TIMEOUT_OPTION_SECONDS = [60, 120, 180, 300, 600, 1200, 1800, 3600, 7200] as const;

/**
 * Returns the canonical timeout list with `currentSec` merged in when it is a
 * positive finite value that isn't already present. Prevents the select from
 * rendering with no selection when the user (or an earlier build) stored a
 * custom value — and prevents a silent downgrade on the next save.
 */
export function resolveTimeoutOptions(currentSec: number): number[] {
  const base: number[] = [...TIMEOUT_OPTION_SECONDS];
  if (Number.isFinite(currentSec) && currentSec > 0 && !base.includes(currentSec)) {
    base.push(currentSec);
    base.sort((a, b) => a - b);
  }
  return base;
}

function AppearanceTab() {
  const t = useT();
  const theme = useCodesignStore((s) => s.theme);
  const setTheme = useCodesignStore((s) => s.setTheme);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [locale, setLocale] = useState<string>('en');

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.locale
      .getCurrent()
      .then((l) => setLocale(l))
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.appearance.languageLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function handleLocaleChange(v: string) {
    if (!window.codesign?.locale) {
      pushToast({
        variant: 'error',
        title: t('errors.localePersistFailed'),
        description: t('errors.rendererDisconnected'),
      });
      return;
    }
    try {
      const applied = await applyLocaleChange(v, window.codesign.locale);
      setLocale(applied);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('errors.localePersistFailed'),
        description: cleanIpcError(err) || t('errors.unknown'),
      });
    }
  }

  const themeCards = [
    {
      value: 'light' as const,
      label: t('settings.appearance.lightLabel'),
      desc: t('settings.appearance.lightDesc'),
    },
    {
      value: 'dark' as const,
      label: t('settings.appearance.darkLabel'),
      desc: t('settings.appearance.darkDesc'),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>{t('settings.appearance.themeTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
          {t('settings.appearance.themeHint')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {themeCards.map((card) => {
          const active = theme === card.value;
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => setTheme(card.value)}
              className={`text-left p-4 rounded-[var(--radius-lg)] border transition-colors ${
                active
                  ? 'border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                {card.label}
              </div>
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
                {card.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-[var(--color-border-subtle)]">
        <Row
          label={t('settings.appearance.languageLabel')}
          hint={t('settings.appearance.languageHint')}
        >
          <NativeSelect
            value={locale}
            onChange={handleLocaleChange}
            options={[
              { value: 'en', label: t('settings.appearance.langEn') },
              { value: 'zh-CN', label: t('settings.appearance.langZhCN') },
              { value: 'pt-BR', label: t('settings.appearance.langPtBR') },
            ]}
          />
        </Row>
      </div>
    </div>
  );
}

// ─── Storage tab ──────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
    >
      {copied ? t('settings.common.copied') : t('settings.common.copy')}
    </button>
  );
}

function PathRow({
  label,
  value,
  onOpen,
  onChoose,
}: {
  label: string;
  value: string;
  onOpen: () => void;
  onChoose?: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <div className="flex gap-1.5">
          <CopyButton value={value} />
          {onChoose !== undefined ? (
            <button
              type="button"
              onClick={onChoose}
              className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('settings.storage.change')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors inline-flex items-center gap-1"
          >
            <FolderOpen className="w-3 h-3" />
            {t('settings.common.open')}
          </button>
        </div>
      </div>
      <code className="block px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-primary)] font-mono truncate">
        {value}
      </code>
    </div>
  );
}

function StorageTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const setView = useCodesignStore((s) => s.setView);
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [choosing, setChoosing] = useState<StorageKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const canChoose = choosing === null;

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .getPaths()
      .then(setPaths)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.storage.pathsLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function openFolder(path: string) {
    try {
      await window.codesign?.settings.openFolder(path);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.openFolderFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function chooseStorageFolder(kind: StorageKind) {
    if (!window.codesign?.settings.chooseStorageFolder) return;
    setChoosing(kind);
    try {
      const next = await window.codesign.settings.chooseStorageFolder(kind);
      setPaths(next);
      pushToast({ variant: 'success', title: t('settings.storage.locationSavedToast') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.locationSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setChoosing(null);
    }
  }

  async function handleReset() {
    if (!window.codesign) return;
    await window.codesign.settings.resetOnboarding();
    const newState = await window.codesign.onboarding.getState();
    completeOnboarding(newState);
    setView('workspace');
    pushToast({ variant: 'info', title: t('settings.storage.onboardingResetToast') });
    setConfirmReset(false);
  }

  async function handleOpenLogFolder() {
    if (!window.codesign?.diagnostics?.openLogFolder) return;
    try {
      await window.codesign.diagnostics.openLogFolder();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.openFolderFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function handleExportDiagnostics() {
    if (!window.codesign?.diagnostics?.exportDiagnostics) return;
    setExporting(true);
    try {
      const zipPath = await window.codesign.diagnostics.exportDiagnostics();
      pushToast({
        variant: 'success',
        title: t('settings.storage.diagnosticsExported', { path: zipPath }),
      });
      void window.codesign.diagnostics.showItemInFolder?.(zipPath);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.storage.diagnosticsExportFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle>{t('settings.storage.pathsTitle')}</SectionTitle>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
        {t('settings.storage.restartHint')}
      </p>

      {paths === null ? (
        <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('settings.common.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          <PathRow
            label={t('settings.storage.config')}
            value={paths.config}
            onOpen={() => void openFolder(paths.configFolder)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('config') } : {})}
          />
          <PathRow
            label={t('settings.storage.logs')}
            value={paths.logs}
            onOpen={() => void openFolder(paths.logsFolder)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('logs') } : {})}
          />
          <PathRow
            label={t('settings.storage.data')}
            value={paths.data}
            onOpen={() => void openFolder(paths.data)}
            {...(canChoose ? { onChoose: () => void chooseStorageFolder('data') } : {})}
          />
        </div>
      )}

      <div className="pt-4 border-t border-[var(--color-border-subtle)]">
        <SectionTitle>{t('settings.storage.diagnosticsTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 mb-3 leading-[var(--leading-body)]">
          {t('settings.storage.diagnosticsHint')}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenLogFolder()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t('settings.storage.openLogFolder')}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportDiagnostics()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
            {t('settings.storage.exportDiagnostics')}
          </button>
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--color-border-subtle)]">
        <SectionTitle>{t('settings.storage.onboardingTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 mb-3 leading-[var(--leading-body)]">
          {t('settings.storage.onboardingHint')}
        </p>

        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              {t('settings.storage.resetConfirm')}
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="h-7 px-3 rounded-[var(--radius-sm)] bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--text-xs)] font-medium hover:opacity-90 transition-opacity"
            >
              {t('settings.storage.reset')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-error)] text-[var(--text-sm)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-on-accent)] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t('settings.storage.resetButton')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Advanced tab ─────────────────────────────────────────────────────────────

function AdvancedTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [prefs, setPrefs] = useState<Preferences>({
    updateChannel: 'stable',
    generationTimeoutSec: 1200,
    checkForUpdatesOnStartup: true,
    dismissedUpdateVersion: '',
    diagnosticsLastReadTs: 0,
  });

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.preferences
      .get()
      .then(setPrefs)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.advanced.prefsLoadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function updatePref(patch: Partial<Preferences>) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.preferences.update(patch);
      setPrefs(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.advanced.prefsSaveFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  async function handleDevtools() {
    if (!window.codesign) return;
    try {
      await window.codesign.settings.toggleDevtools();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.advanced.devtoolsFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
      });
    }
  }

  return (
    <div className="space-y-1">
      <Row
        label={t('settings.advanced.updateChannel')}
        hint={t('settings.advanced.updateChannelHint')}
      >
        <SegmentedControl
          options={[
            { value: 'stable', label: t('settings.advanced.stable') },
            { value: 'beta', label: t('settings.advanced.beta') },
          ]}
          value={prefs.updateChannel}
          onChange={(v) => void updatePref({ updateChannel: v })}
        />
      </Row>

      <Row
        label={t('settings.advanced.checkForUpdatesOnStartup')}
        hint={t('settings.advanced.checkForUpdatesOnStartupHint')}
      >
        <input
          type="checkbox"
          checked={prefs.checkForUpdatesOnStartup}
          onChange={(e) => void updatePref({ checkForUpdatesOnStartup: e.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <Row label={t('settings.advanced.timeout')} hint={t('settings.advanced.timeoutHint')}>
        <NativeSelect
          value={String(prefs.generationTimeoutSec)}
          onChange={(v) => void updatePref({ generationTimeoutSec: Number(v) })}
          options={resolveTimeoutOptions(prefs.generationTimeoutSec).map((sec) => ({
            value: String(sec),
            label: t('settings.advanced.timeoutSeconds', { value: sec }),
          }))}
        />
      </Row>

      <Row label={t('settings.advanced.devtools')} hint={t('settings.advanced.devtoolsHint')}>
        <button
          type="button"
          onClick={handleDevtools}
          className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          {t('settings.advanced.toggleDevtools')}
        </button>
      </Row>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function Settings() {
  const t = useT();
  const initialTab = useCodesignStore((s) => s.settingsTab);
  const clearSettingsTab = useCodesignStore((s) => s.clearSettingsTab);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'models');

  // Consume the store hint exactly once on mount so future Settings opens
  // start on whatever the user last selected manually.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    if (initialTab) clearSettingsTab();
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <div className="flex-1 grid grid-cols-[11rem_1fr] min-h-0">
        <aside className="bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] p-[var(--space-3)]">
          <nav className="space-y-0.5">
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`relative w-full flex items-center gap-2 pl-[var(--space-3)] pr-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--text-sm)] transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)] ${
                    active
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] font-medium before:absolute before:left-0 before:top-[var(--space-1_5)] before:bottom-[var(--space-1_5)] before:w-[var(--size-accent-stripe)] before:rounded-full before:bg-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {t(`settings.tabs.${entry.id}`)}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex flex-col min-h-0 overflow-y-auto p-[var(--space-6)]">
          {tab === 'models' ? <ModelsTab /> : null}
          {tab === 'appearance' ? <AppearanceTab /> : null}
          {tab === 'storage' ? <StorageTab /> : null}
          {tab === 'diagnostics' ? <DiagnosticsPanel /> : null}
          {tab === 'advanced' ? <AdvancedTab /> : null}
        </section>
      </div>
    </div>
  );
}

interface AddProviderMenuProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  hasClaudeCodeImported: boolean;
  hasOllamaImported: boolean;
  onImportCodex: () => void;
  onImportClaudeCode: () => void;
  onAddOllama: () => void;
  onAddCustom: () => void;
}

function AddProviderMenu({
  open,
  setOpen,
  hasClaudeCodeImported,
  hasOllamaImported,
  onImportCodex,
  onImportClaudeCode,
  onAddOllama,
  onAddCustom,
}: AddProviderMenuProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);

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
  }, [open, setOpen]);

  const items: Array<{
    key: string;
    label: string;
    desc: string;
    disabled: boolean;
    onClick: () => void;
  }> = [
    {
      key: 'codex',
      label: t('settings.providers.import.codexMenu', { defaultValue: '从 Codex 导入' }),
      desc: t('settings.providers.import.codexMenuDesc', {
        defaultValue: '读取 ~/.codex/config.toml',
      }),
      disabled: false,
      onClick: onImportCodex,
    },
    {
      key: 'claudeCode',
      label: t('settings.providers.import.claudeCodeMenu', {
        defaultValue: '从 Claude Code 导入',
      }),
      desc: t('settings.providers.import.claudeCodeMenuDesc', {
        defaultValue: '读取已登录的 Claude Code 会话',
      }),
      disabled: hasClaudeCodeImported,
      onClick: onImportClaudeCode,
    },
    {
      key: 'ollama',
      label: t('settings.providers.import.ollamaMenu'),
      desc: t('settings.providers.import.ollamaMenuDesc'),
      disabled: hasOllamaImported,
      onClick: onAddOllama,
    },
    {
      key: 'custom',
      label: t('settings.providers.import.customMenu', { defaultValue: '自定义服务' }),
      desc: t('settings.providers.import.customMenuDesc', {
        defaultValue: '手动填写 API key 和 URL',
      }),
      disabled: false,
      onClick: onAddCustom,
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
        <Plus className="w-3.5 h-3.5" />
        {t('settings.providers.addProvider')}
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-[6px] z-50 w-[260px] rounded-[10px] border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[0_8px_28px_rgba(0,0,0,0.1)] overflow-hidden"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onClick}
              className="w-full text-left px-[14px] py-[10px] flex flex-col gap-[2px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--color-surface-hover)]"
            >
              <span className="flex items-center gap-[6px] text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.label}
                {item.disabled ? (
                  <Check className="w-[12px] h-[12px] text-[var(--color-accent)]" />
                ) : null}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)] leading-[1.4]">
                {item.disabled
                  ? t('settings.providers.import.alreadyImported', {
                      defaultValue: '已导入',
                    })
                  : item.desc}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
