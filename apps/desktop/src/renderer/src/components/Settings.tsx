import { setLocale as applyLocale, i18n, useT } from '@open-codesign/i18n';
import type {
  ErrorCode,
  OnboardingState,
  PROVIDER_SHORTLIST,
  SupportedOnboardingProvider,
} from '@open-codesign/shared';
import {
  PROVIDER_SHORTLIST as SHORTLIST,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button, Tooltip } from '@open-codesign/ui';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Cpu,
  FolderOpen,
  Globe,
  Loader2,
  Palette,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AppPaths, Preferences, ProviderRow } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { ConnectionDiagnosticPanel } from './ConnectionDiagnosticPanel';

type Tab = 'models' | 'appearance' | 'storage' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; icon: typeof Cpu }> = [
  { id: 'models', icon: Cpu },
  { id: 'appearance', icon: Palette },
  { id: 'storage', icon: FolderOpen },
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

function TextInput({
  value,
  onChange,
  placeholder,
  type,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ''}`}
    />
  );
}

// ─── Models tab ──────────────────────────────────────────────────────────────

interface AddProviderFormState {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl: string;
  modelPrimary: string;
  modelFast: string;
  validating: boolean;
  error: string | null;
  errorCode: ErrorCode | null;
  validated: boolean;
}

function makeDefaultForm(provider: SupportedOnboardingProvider): AddProviderFormState {
  const sl = SHORTLIST[provider];
  return {
    provider,
    apiKey: '',
    baseUrl: '',
    modelPrimary: sl.defaultPrimary,
    modelFast: sl.defaultFast,
    validating: false,
    error: null,
    errorCode: null,
    validated: false,
  };
}

export function canSaveProvider(
  form: Pick<AddProviderFormState, 'apiKey' | 'validated' | 'validating'>,
): boolean {
  return form.apiKey.trim().length > 0 && form.validated && !form.validating;
}

interface ValidateSnapshot {
  provider: SupportedOnboardingProvider;
  apiKey: string;
  baseUrl: string;
}

/**
 * Pure reducer used by handleValidate — applies the validation result only when
 * the current form still matches the snapshot taken before the async call.
 * Exported for unit testing without a DOM.
 */
export function applyValidateResult(
  current: AddProviderFormState,
  snapshot: ValidateSnapshot,
  ok: boolean,
  message: string | undefined,
  errorCode?: ErrorCode,
): AddProviderFormState {
  if (
    current.provider !== snapshot.provider ||
    current.apiKey.trim() !== snapshot.apiKey ||
    current.baseUrl.trim() !== snapshot.baseUrl
  ) {
    // Form changed while we were waiting — discard the stale result.
    return current;
  }
  if (ok) {
    return { ...current, validating: false, validated: true, error: null, errorCode: null };
  }
  return {
    ...current,
    validating: false,
    error: message ?? 'Validation failed',
    errorCode: errorCode ?? null,
  };
}

function AddProviderModal({
  onSave,
  onClose,
}: {
  onSave: (rows: ProviderRow[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const providerOptions: { value: SupportedOnboardingProvider; label: string }[] = [
    { value: 'anthropic', label: 'Anthropic Claude' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'openrouter', label: 'OpenRouter' },
  ];

  const [form, setForm] = useState<AddProviderFormState>(makeDefaultForm('anthropic'));
  const [logsFolder, setLogsFolder] = useState<string | undefined>(undefined);
  const pushToast = useCodesignStore((s) => s.pushToast);

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .getPaths()
      .then((p) => setLogsFolder(p.logsFolder))
      .catch((err: unknown) => {
        pushToast({
          variant: 'error',
          title: i18n.t('settings.storage.pathsLoadFailed') as string,
          description: err instanceof Error ? err.message : String(err),
        });
      });
  }, [pushToast]);

  function setField<K extends keyof AddProviderFormState>(k: K, v: AddProviderFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v, error: null, errorCode: null, validated: false }));
  }

  function handleProviderChange(p: string) {
    if (!isSupportedOnboardingProvider(p)) return;
    setForm(makeDefaultForm(p));
  }

  async function handleValidate() {
    if (!window.codesign) return;
    const snapshot = {
      provider: form.provider,
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
    };
    setForm((prev) => ({
      ...prev,
      validating: true,
      error: null,
      errorCode: null,
      validated: false,
    }));
    try {
      const res = await window.codesign.settings.validateKey({
        provider: snapshot.provider,
        apiKey: snapshot.apiKey,
        ...(snapshot.baseUrl.length > 0 ? { baseUrl: snapshot.baseUrl } : {}),
      });
      setForm((current) =>
        applyValidateResult(
          current,
          snapshot,
          res.ok,
          res.ok ? undefined : res.message,
          res.ok ? undefined : res.code,
        ),
      );
    } finally {
      setForm((current) => (current.validating ? { ...current, validating: false } : current));
    }
  }

  async function handleSave() {
    if (!window.codesign) return;
    try {
      const trimmedUrl = form.baseUrl.trim();
      const rows = await window.codesign.settings.addProvider({
        provider: form.provider,
        apiKey: form.apiKey.trim(),
        modelPrimary: form.modelPrimary,
        modelFast: form.modelFast,
        ...(trimmedUrl.length > 0 ? { baseUrl: trimmedUrl } : {}),
      });
      onSave(rows);
    } catch (err) {
      setForm((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : t('settings.common.unknownError'),
      }));
    }
  }

  const sl = SHORTLIST[form.provider];
  const primaryOptions = sl.primary.map((m) => ({ value: m, label: m }));
  const fastOptions = sl.fast.map((m) => ({ value: m, label: m }));
  const canSave = canSaveProvider(form);

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.providers.modal.title')}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-[var(--color-overlay)]"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="w-full max-w-md bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-xl)] shadow-[var(--shadow-elevated)] p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[var(--text-base)] font-semibold text-[var(--color-text-primary)]">
            {t('settings.providers.modal.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
              {t('settings.providers.modal.provider')}
            </p>
            <NativeSelect
              value={form.provider}
              onChange={handleProviderChange}
              options={providerOptions}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
                {t('settings.providers.modal.apiKey')}
              </p>
              <a
                href={sl.keyHelpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--text-xs)] text-[var(--color-accent)] hover:underline"
              >
                {t('settings.providers.modal.getKey')}
              </a>
            </div>
            <div className="flex gap-2">
              <TextInput
                type="password"
                value={form.apiKey}
                onChange={(v) => setField('apiKey', v)}
                placeholder={t('settings.providers.modal.apiKeyPlaceholder')}
                className="flex-1"
              />
              <Tooltip
                label={
                  form.apiKey.trim().length === 0 || form.validating
                    ? t('disabledReason.enterApiKeyToValidate')
                    : undefined
                }
                side="top"
              >
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={form.apiKey.trim().length === 0 || form.validating}
                  className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                >
                  {form.validating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : form.validated ? (
                    <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" />
                  ) : null}
                  {form.validating
                    ? t('settings.providers.modal.validating')
                    : form.validated
                      ? t('settings.providers.modal.valid')
                      : t('settings.providers.modal.validate')}
                </button>
              </Tooltip>
            </div>
            {form.error && form.errorCode !== null ? (
              <div className="mt-2">
                <ConnectionDiagnosticPanel
                  errorCode={form.errorCode}
                  httpStatus={form.error}
                  baseUrl={form.baseUrl}
                  provider={form.provider}
                  {...(logsFolder !== undefined ? { logsPath: logsFolder } : {})}
                  onApplyFix={(newUrl) =>
                    setForm((prev) => ({
                      ...prev,
                      baseUrl: newUrl,
                      error: null,
                      errorCode: null,
                      validated: false,
                    }))
                  }
                  onTestAgain={() => void handleValidate()}
                  onDismiss={() => setForm((prev) => ({ ...prev, error: null, errorCode: null }))}
                />
              </div>
            ) : form.error !== null ? (
              <p className="mt-1.5 text-[var(--text-xs)] text-[var(--color-error)]">{form.error}</p>
            ) : null}
          </div>

          <div>
            <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
              {t('settings.providers.modal.baseUrl')}{' '}
              <span className="text-[var(--color-text-muted)] font-normal">
                {t('settings.providers.modal.baseUrlOptional')}
              </span>
            </p>
            <TextInput
              value={form.baseUrl}
              onChange={(v) => setField('baseUrl', v)}
              placeholder={t('settings.providers.modal.baseUrlPlaceholder')}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
                {t('settings.providers.modal.primaryModel')}
              </p>
              <NativeSelect
                value={form.modelPrimary}
                onChange={(v) => setField('modelPrimary', v)}
                options={primaryOptions}
              />
            </div>
            <div>
              <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
                {t('settings.providers.modal.fastModel')}
              </p>
              <NativeSelect
                value={form.modelFast}
                onChange={(v) => setField('modelFast', v)}
                options={fastOptions}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Tooltip label={!canSave ? t('disabledReason.validateKeyFirst') : undefined} side="top">
            <Button size="sm" onClick={handleSave} disabled={!canSave}>
              {t('settings.providers.modal.save')}
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({
  row,
  config,
  onDelete,
  onActivate,
  onReEnterKey,
}: {
  row: ProviderRow;
  config: OnboardingState | null;
  onDelete: (p: SupportedOnboardingProvider) => void;
  onActivate: (p: SupportedOnboardingProvider) => void;
  onReEnterKey: (p: SupportedOnboardingProvider) => void;
}) {
  const t = useT();
  const label = SHORTLIST[row.provider]?.label ?? row.provider;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasError = row.error !== undefined;

  const stateClass = hasError
    ? 'border-[var(--color-error)] bg-[var(--color-surface)]'
    : row.isActive
      ? 'border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface)]';

  return (
    <div
      className={`rounded-[var(--radius-lg)] border px-[var(--space-3)] py-[var(--space-2_5)] transition-colors ${stateClass}`}
    >
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          {row.isActive && !hasError && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent text-[var(--font-size-badge)] font-medium leading-none">
              {t('settings.providers.active')}
            </span>
          )}
          {hasError && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--font-size-badge)] font-medium leading-none">
              <AlertTriangle className="w-2.5 h-2.5" />
              {t('settings.providers.decryptionFailed')}
            </span>
          )}
          {!hasError && (
            <code className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono">
              {row.maskedKey}
            </code>
          )}
          {row.baseUrl && (
            <span className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] min-w-0">
              <Globe className="w-3 h-3 shrink-0" />
              <span className="truncate">{row.baseUrl}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!row.isActive && !hasError && (
            <button
              type="button"
              onClick={() => onActivate(row.provider)}
              className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('settings.providers.setActive')}
            </button>
          )}
          {hasError && (
            <button
              type="button"
              onClick={() => onReEnterKey(row.provider)}
              className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-error)] border border-[var(--color-error)] bg-[var(--color-surface)] hover:opacity-80 transition-opacity"
            >
              {t('settings.providers.reEnterKey')}
            </button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(row.provider);
                }}
                className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-error)] hover:opacity-90 transition-opacity"
              >
                {t('settings.providers.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label={t('settings.providers.deleteAria', { label })}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {row.isActive && !hasError && config !== null && (
        <ActiveModelSelector config={config} provider={row.provider} />
      )}
    </div>
  );
}

function ActiveModelSelector({
  config,
  provider,
}: {
  config: OnboardingState;
  provider: SupportedOnboardingProvider;
}) {
  const t = useT();
  const sl = SHORTLIST[provider];
  const primaryOptions = sl.primary.map((m) => ({ value: m, label: m }));
  const fastOptions = sl.fast.map((m) => ({ value: m, label: m }));
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [primary, setPrimary] = useState(config.modelPrimary ?? sl.defaultPrimary);
  const [fast, setFast] = useState(config.modelFast ?? sl.defaultFast);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPrimary(config.modelPrimary ?? sl.defaultPrimary);
    setFast(config.modelFast ?? sl.defaultFast);
  }, [config.modelPrimary, config.modelFast, sl.defaultPrimary, sl.defaultFast]);

  useEffect(() => {
    return () => {
      if (saveTimeout.current !== null) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
    };
  }, []);

  async function save(p: string, f: string) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: p,
        modelFast: f,
      });
      setConfig(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.modelSaveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    }
  }

  function handlePrimaryChange(v: string) {
    setPrimary(v);
    if (saveTimeout.current !== null) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => void save(v, fast), 400);
  }

  function handleFastChange(v: string) {
    setFast(v);
    if (saveTimeout.current !== null) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => void save(primary, v), 400);
  }

  return (
    <div className="mt-[var(--space-2_5)] pt-[var(--space-2_5)] border-t border-[var(--color-border-subtle)] grid grid-cols-2 gap-[var(--space-3)]">
      <div>
        <p className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] mb-1.5">
          <Cpu className="w-3 h-3" /> {t('settings.providers.primary')}
        </p>
        <NativeSelect value={primary} onChange={handlePrimaryChange} options={primaryOptions} />
      </div>
      <div>
        <p className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] mb-1.5">
          <Zap className="w-3 h-3" /> {t('settings.providers.fast')}
        </p>
        <NativeSelect value={fast} onChange={handleFastChange} options={fastOptions} />
      </div>
    </div>
  );
}

function ModelsTab() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [reEnterProvider, setReEnterProvider] = useState<SupportedOnboardingProvider | null>(null);

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .listProviders()
      .then(setRows)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.providers.toast.loadFailed'),
          description: err instanceof Error ? err.message : t('settings.common.unknownError'),
        });
      })
      .finally(() => setLoading(false));
  }, [pushToast, t]);

  async function handleDelete(provider: SupportedOnboardingProvider) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.deleteProvider(provider);
      setRows(next);
      const newState = await window.codesign.onboarding.getState();
      setConfig(newState);
      pushToast({ variant: 'success', title: t('settings.providers.toast.removed') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.deleteFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    }
  }

  async function handleActivate(provider: SupportedOnboardingProvider) {
    if (!window.codesign) return;
    const sl = SHORTLIST[provider];
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: sl.defaultPrimary,
        modelFast: sl.defaultFast,
      });
      setConfig(next);
      const updatedRows = await window.codesign.settings.listProviders();
      setRows(updatedRows);
      pushToast({
        variant: 'success',
        title: t('settings.providers.toast.switchedTo', { label: sl.label }),
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.switchFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    }
  }

  function handleAddSave(nextRows: ProviderRow[]) {
    setRows(nextRows);
    setShowAdd(false);
    setReEnterProvider(null);
    pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
  }

  return (
    <>
      {(showAdd || reEnterProvider !== null) && (
        <AddProviderModal
          onSave={handleAddSave}
          onClose={() => {
            setShowAdd(false);
            setReEnterProvider(null);
          }}
        />
      )}

      <div className="space-y-[var(--space-3)]">
        <div className="flex items-center justify-between gap-[var(--space-3)] min-h-[var(--size-control-sm)]">
          <SectionTitle>{t('settings.providers.sectionTitle')}</SectionTitle>
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.providers.addProvider')}
          </Button>
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
                onReEnterKey={setReEnterProvider}
              />
            ))}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-[var(--space-1_5)] h-[var(--size-control-md)] rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-transparent text-[var(--text-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('settings.providers.addProvider')}
            </button>
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
          description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('errors.unknown'),
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

function PathRow({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <div className="flex gap-1.5">
          <CopyButton value={value} />
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

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .getPaths()
      .then(setPaths)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.storage.pathsLoadFailed'),
          description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
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

  return (
    <div className="space-y-5">
      <SectionTitle>{t('settings.storage.pathsTitle')}</SectionTitle>

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
            onOpen={() => openFolder(paths.configFolder)}
          />
          <PathRow
            label={t('settings.storage.logs')}
            value={paths.logs}
            onOpen={() => openFolder(paths.logsFolder)}
          />
          <PathRow
            label={t('settings.storage.data')}
            value={paths.data}
            onOpen={() => openFolder(paths.data)}
          />
        </div>
      )}

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
    generationTimeoutSec: 120,
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
          description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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

      <Row label={t('settings.advanced.timeout')} hint={t('settings.advanced.timeoutHint')}>
        <NativeSelect
          value={String(prefs.generationTimeoutSec)}
          onChange={(v) => void updatePref({ generationTimeoutSec: Number(v) })}
          options={[
            { value: '60', label: t('settings.advanced.timeoutSeconds', { value: 60 }) },
            { value: '120', label: t('settings.advanced.timeoutSeconds', { value: 120 }) },
            { value: '180', label: t('settings.advanced.timeoutSeconds', { value: 180 }) },
            { value: '300', label: t('settings.advanced.timeoutSeconds', { value: 300 }) },
          ]}
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
  const setView = useCodesignStore((s) => s.setView);
  const [tab, setTab] = useState<Tab>('models');

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <header className="flex items-center gap-3 px-5 h-12 border-b border-[var(--color-border)] shrink-0">
        <button
          type="button"
          onClick={() => setView('workspace')}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label={t('settings.shell.backAria')}
        >
          <ArrowLeft className="w-4 h-4" />
          {t('settings.shell.back')}
        </button>
        <span className="text-[var(--color-text-muted)]">/</span>
        <span className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
          {t(`settings.tabs.${tab}`)}
        </span>
      </header>

      <div className="flex-1 grid grid-cols-[11rem_1fr] min-h-0">
        <aside className="bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] p-3">
          <div className="flex items-center gap-2 px-2 py-2 mb-2">
            <Sliders className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
              {t('settings.title')}
            </span>
          </div>
          <nav className="space-y-0.5">
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`relative w-full flex items-center gap-2 pl-[var(--space-3)] pr-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--text-sm)] transition-colors ${
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

        <section className="flex flex-col min-h-0 overflow-y-auto p-5">
          {tab === 'models' ? <ModelsTab /> : null}
          {tab === 'appearance' ? <AppearanceTab /> : null}
          {tab === 'storage' ? <StorageTab /> : null}
          {tab === 'advanced' ? <AdvancedTab /> : null}
        </section>
      </div>
    </div>
  );
}
