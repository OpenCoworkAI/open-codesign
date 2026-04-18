import { setLocale as applyLocale } from '@open-codesign/i18n';
import type {
  OnboardingState,
  PROVIDER_SHORTLIST,
  SupportedOnboardingProvider,
} from '@open-codesign/shared';
import {
  PROVIDER_SHORTLIST as SHORTLIST,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import {
  AlertTriangle,
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

type Tab = 'models' | 'appearance' | 'storage' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'storage', label: 'Storage', icon: FolderOpen },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
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
    return { ...current, validating: false, validated: true };
  }
  return { ...current, validating: false, error: message ?? 'Validation failed' };
}

function AddProviderModal({
  onSave,
  onClose,
}: {
  onSave: (rows: ProviderRow[]) => void;
  onClose: () => void;
}) {
  const providerOptions: { value: SupportedOnboardingProvider; label: string }[] = [
    { value: 'anthropic', label: 'Anthropic Claude' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'openrouter', label: 'OpenRouter' },
  ];

  const [form, setForm] = useState<AddProviderFormState>(makeDefaultForm('anthropic'));

  function setField<K extends keyof AddProviderFormState>(k: K, v: AddProviderFormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v, error: null, validated: false }));
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
    setForm((prev) => ({ ...prev, validating: true, error: null, validated: false }));
    try {
      const res = await window.codesign.settings.validateKey({
        provider: snapshot.provider,
        apiKey: snapshot.apiKey,
        ...(snapshot.baseUrl.length > 0 ? { baseUrl: snapshot.baseUrl } : {}),
      });
      // Discard result if the user changed provider/key/baseUrl while we were waiting.
      setForm((current) =>
        applyValidateResult(current, snapshot, res.ok, res.ok ? undefined : res.message),
      );
    } finally {
      // Ensure validating spinner clears even if we discarded the result.
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
        error: err instanceof Error ? err.message : 'Save failed',
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
      aria-label="Add provider"
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
            Add provider
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
              Provider
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
                API Key
              </p>
              <a
                href={sl.keyHelpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--text-xs)] text-[var(--color-accent)] hover:underline"
              >
                Get key ↗
              </a>
            </div>
            <div className="flex gap-2">
              <TextInput
                type="password"
                value={form.apiKey}
                onChange={(v) => setField('apiKey', v)}
                placeholder="sk-..."
                className="flex-1"
              />
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
                {form.validated ? 'Valid' : 'Validate'}
              </button>
            </div>
            {form.error && (
              <p className="mt-1.5 text-[var(--text-xs)] text-[var(--color-error)]">{form.error}</p>
            )}
          </div>

          <div>
            <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
              Base URL{' '}
              <span className="text-[var(--color-text-muted)] font-normal">(optional)</span>
            </p>
            <TextInput
              value={form.baseUrl}
              onChange={(v) => setField('baseUrl', v)}
              placeholder="https://your-proxy.example.com"
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
                Primary model
              </p>
              <NativeSelect
                value={form.modelPrimary}
                onChange={(v) => setField('modelPrimary', v)}
                options={primaryOptions}
              />
            </div>
            <div>
              <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
                Fast model
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
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            Save provider
          </Button>
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
  const label = SHORTLIST[row.provider]?.label ?? row.provider;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasError = row.error !== undefined;

  return (
    <div
      className={`rounded-[var(--radius-lg)] border p-3 transition-colors ${
        hasError
          ? 'border-[var(--color-error)] bg-[var(--color-error-soft,var(--color-surface))]'
          : row.isActive
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
              {label}
            </span>
            {row.isActive && !hasError && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--font-size-badge)] font-medium leading-none">
                Active
              </span>
            )}
            {hasError && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--font-size-badge)] font-medium leading-none">
                <AlertTriangle className="w-2.5 h-2.5" />
                Decryption failed
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            {!hasError && (
              <code className="text-[var(--text-xs)] text-[var(--color-text-muted)] font-mono">
                {row.maskedKey}
              </code>
            )}
            {row.baseUrl && (
              <span className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                <Globe className="w-3 h-3" />
                {row.baseUrl}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!row.isActive && !hasError && (
            <button
              type="button"
              onClick={() => onActivate(row.provider)}
              className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Set active
            </button>
          )}
          {hasError && (
            <button
              type="button"
              onClick={() => onReEnterKey(row.provider)}
              className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-error)] border border-[var(--color-error)] bg-[var(--color-surface)] hover:opacity-80 transition-opacity"
            >
              Re-enter key
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
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label={`Delete ${label} provider`}
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
  const sl = SHORTLIST[provider];
  const primaryOptions = sl.primary.map((m) => ({ value: m, label: m }));
  const fastOptions = sl.fast.map((m) => ({ value: m, label: m }));
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [primary, setPrimary] = useState(config.modelPrimary ?? sl.defaultPrimary);
  const [fast, setFast] = useState(config.modelFast ?? sl.defaultFast);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        title: 'Failed to save model selection',
        description: err instanceof Error ? err.message : 'Unknown error',
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
    <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] grid grid-cols-2 gap-3">
      <div>
        <p className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] mb-1.5">
          <Cpu className="w-3 h-3" /> Primary
        </p>
        <NativeSelect value={primary} onChange={handlePrimaryChange} options={primaryOptions} />
      </div>
      <div>
        <p className="flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)] mb-1.5">
          <Zap className="w-3 h-3" /> Fast
        </p>
        <NativeSelect value={fast} onChange={handleFastChange} options={fastOptions} />
      </div>
    </div>
  );
}

function ModelsTab() {
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
          title: 'Failed to load providers',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      })
      .finally(() => setLoading(false));
  }, [pushToast]);

  async function handleDelete(provider: SupportedOnboardingProvider) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.deleteProvider(provider);
      setRows(next);
      const newState = await window.codesign.onboarding.getState();
      setConfig(newState);
      pushToast({ variant: 'success', title: 'Provider removed' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unknown error',
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
      pushToast({ variant: 'success', title: `Switched to ${sl.label}` });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Switch failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  function handleAddSave(nextRows: ProviderRow[]) {
    setRows(nextRows);
    setShowAdd(false);
    setReEnterProvider(null);
    pushToast({ variant: 'success', title: 'Provider saved' });
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

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionTitle>API Providers</SectionTitle>
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add provider
          </Button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
            No providers configured yet. Add one to start generating.
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
          </div>
        )}
      </div>
    </>
  );
}

// ─── Appearance tab ───────────────────────────────────────────────────────────

function AppearanceTab() {
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
          title: 'Failed to load language',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      });
  }, [pushToast]);

  async function handleLocaleChange(v: string) {
    if (!window.codesign) return;
    try {
      const persisted = await window.codesign.locale.set(v);
      const applied = await applyLocale(persisted);
      setLocale(applied);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Failed to save language',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Theme</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
          Choice persists across restarts.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { value: 'light', label: 'Light', desc: 'Warm beige, soft shadows' },
            { value: 'dark', label: 'Dark', desc: 'Deep neutral, low glare' },
          ] as const
        ).map((t) => {
          const active = theme === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTheme(t.value)}
              className={`text-left p-4 rounded-[var(--radius-lg)] border transition-colors ${
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                {t.label}
              </div>
              <div className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1">
                {t.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div className="pt-2 border-t border-[var(--color-border-subtle)]">
        <Row label="Language" hint="Language changes take effect immediately.">
          <NativeSelect
            value={locale}
            onChange={handleLocaleChange}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '中文 (简体)' },
            ]}
          />
        </Row>
      </div>
    </div>
  );
}

// ─── Storage tab ──────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
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
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function PathRow({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
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
            Open
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
  const pushToast = useCodesignStore((s) => s.pushToast);
  const closeSettings = useCodesignStore((s) => s.closeSettings);
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
          title: 'Failed to load app paths',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      });
  }, [pushToast]);

  async function openFolder(path: string) {
    try {
      await window.codesign?.settings.openFolder(path);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Could not open folder',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async function handleReset() {
    if (!window.codesign) return;
    await window.codesign.settings.resetOnboarding();
    const newState = await window.codesign.onboarding.getState();
    completeOnboarding(newState);
    closeSettings();
    pushToast({ variant: 'info', title: 'Onboarding reset. Restart the app to re-run setup.' });
    setConfirmReset(false);
  }

  return (
    <div className="space-y-5">
      <SectionTitle>Paths</SectionTitle>

      {paths === null ? (
        <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <PathRow
            label="Config"
            value={paths.config}
            onOpen={() => openFolder(paths.configFolder)}
          />
          <PathRow label="Logs" value={paths.logs} onOpen={() => openFolder(paths.logsFolder)} />
          <PathRow
            label="Data directory"
            value={paths.data}
            onOpen={() => openFolder(paths.data)}
          />
        </div>
      )}

      <div className="pt-4 border-t border-[var(--color-border-subtle)]">
        <SectionTitle>Onboarding</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 mb-3 leading-[var(--leading-body)]">
          Clear the setup flag so the onboarding wizard runs again on next launch.
        </p>

        {confirmReset ? (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              This will remove your saved keys. Continue?
            </span>
            <button
              type="button"
              onClick={handleReset}
              className="h-7 px-3 rounded-[var(--radius-sm)] bg-[var(--color-error)] text-[var(--color-on-accent)] text-[var(--text-xs)] font-medium hover:opacity-90 transition-opacity"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-error)] text-[var(--text-sm)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-on-accent)] transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset onboarding
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Advanced tab ─────────────────────────────────────────────────────────────

function AdvancedTab() {
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
          title: 'Failed to load preferences',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      });
  }, [pushToast]);

  async function updatePref(patch: Partial<Preferences>) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.preferences.update(patch);
      setPrefs(next);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'Failed to save preference',
        description: err instanceof Error ? err.message : 'Unknown error',
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
        title: 'Could not toggle DevTools',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return (
    <div className="space-y-1">
      <Row
        label="Update channel"
        hint="Stable: tested releases. Beta: early access (may have bugs)."
      >
        <SegmentedControl
          options={[
            { value: 'stable', label: 'Stable' },
            { value: 'beta', label: 'Beta' },
          ]}
          value={prefs.updateChannel}
          onChange={(v) => void updatePref({ updateChannel: v })}
        />
      </Row>

      <Row label="Generation timeout" hint="Seconds before a generation request is aborted.">
        <NativeSelect
          value={String(prefs.generationTimeoutSec)}
          onChange={(v) => void updatePref({ generationTimeoutSec: Number(v) })}
          options={[
            { value: '60', label: '60 s' },
            { value: '120', label: '120 s' },
            { value: '180', label: '180 s' },
            { value: '300', label: '300 s' },
          ]}
        />
      </Row>

      <Row label="Developer tools" hint="Open the Chromium DevTools panel for the renderer.">
        <button
          type="button"
          onClick={handleDevtools}
          className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          Toggle DevTools
        </button>
      </Row>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function Settings() {
  const open = useCodesignStore((s) => s.settingsOpen);
  const close = useCodesignStore((s) => s.closeSettings);
  const [tab, setTab] = useState<Tab>('models');

  if (!open) return null;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> top-layer rendering interferes with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        className="w-full max-w-3xl h-[36rem] rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] grid grid-cols-[11rem_1fr] overflow-hidden animate-[panel-in_160ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <aside className="bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] p-3">
          <div className="flex items-center gap-2 px-2 py-2 mb-2">
            <Sliders className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)]">
              Settings
            </span>
          </div>
          <nav className="space-y-0.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-md)] text-[var(--text-sm)] transition-colors ${
                    active
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] font-medium'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex flex-col min-w-0">
          <header className="flex items-center justify-between px-5 h-12 border-b border-[var(--color-border)] shrink-0">
            <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-text-primary)] capitalize">
              {tab}
            </h2>
            <Button variant="ghost" size="sm" onClick={close} aria-label="Close settings">
              <X className="w-4 h-4" />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto p-5">
            {tab === 'models' ? <ModelsTab /> : null}
            {tab === 'appearance' ? <AppearanceTab /> : null}
            {tab === 'storage' ? <StorageTab /> : null}
            {tab === 'advanced' ? <AdvancedTab /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
