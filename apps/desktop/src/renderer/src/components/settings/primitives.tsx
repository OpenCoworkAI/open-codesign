import { getCurrentLocale, useT } from '@open-codesign/i18n';
import type { OnboardingState, ReasoningLevel } from '@open-codesign/shared';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Cpu,
  FolderOpen,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Sliders,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderRow } from '../../../../preload/index';
import { recordAction } from '../../lib/action-timeline';
import { useCodesignStore } from '../../store';

/**
 * Electron IPC wraps thrown errors as
 * `Error invoking remote method '<channel>': <ErrorName>: <message>`.
 * Strip the wrapper and, for bilingual messages formatted as `en / zh`,
 * pick the side matching the active locale.
 */
export function cleanIpcError(err: unknown): string {
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
 * Build the <select> options for the active-provider model dropdown.
 * Pins an active id that is missing from the fetched list at the top so
 * the UI always matches reality (issue #136). Returns null when there is
 * nothing to render so callers can show a plain text fallback.
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

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)]">
      {children}
    </span>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
      {children}
    </h3>
  );
}

export function Row({
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

export function SegmentedControl<T extends string>({
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

export function NativeSelect({
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

export function ProviderOverflowMenu({
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

export function ProviderCard({
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

export function RowModelSelector({
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
        // Inactive row: persist the per-provider default so "Set as current"
        // later picks it up via currentRow.defaultModel.
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

type ReasoningOption = '' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export function ReasoningDepthSelector({
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
  // Optimistic local state so the dropdown reflects the user's choice
  // immediately, before the IPC round-trip resolves.
  const [current, setCurrent] = useState<ReasoningOption>(value ?? '');
  useEffect(() => {
    setCurrent(value ?? '');
  }, [value]);
  const saveSeq = useRef(0);

  async function handleChange(next: ReasoningOption) {
    if (!window.codesign?.config?.updateProvider) return;
    const prev = current;
    const seq = ++saveSeq.current;
    setCurrent(next);
    setSaving(true);
    try {
      const payload = { id: provider, reasoningLevel: next === '' ? null : next } as const;
      await window.codesign.config.updateProvider(payload);
      pushToast({ variant: 'success', title: t('settings.providers.toast.reasoningSaved') });
      if (window.codesign?.settings?.listProviders) {
        const rows = await window.codesign.settings.listProviders();
        const row = rows.find((r) => r.provider === provider);
        if (row) onUpdated(row);
      }
    } catch (err) {
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
    { value: 'off', label: t('settings.providers.reasoning.off') },
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

export function ImportBanner({
  label,
  onImport,
  onDismiss,
  actionLabel,
  tone = 'accent',
}: {
  label: string;
  /** Omit to render a warning-only banner with no import button. */
  onImport?: () => void;
  onDismiss: () => void;
  actionLabel?: string;
  tone?: 'accent' | 'info';
}) {
  const t = useT();
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

export function ParseErrorBanner({
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

export function WarningsList({ warnings }: { warnings: string[] }) {
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

export function CopyButton({ value }: { value: string }) {
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

export function PathRow({
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
