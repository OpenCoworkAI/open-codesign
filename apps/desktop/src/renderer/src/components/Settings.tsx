import { setLocale as applyLocale, useT } from '@open-codesign/i18n';
import type { OnboardingState, ReasoningLevel } from '@open-codesign/shared';
import {
  PROVIDER_SHORTLIST as SHORTLIST,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import {
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
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AppPaths, Preferences, ProviderRow, StorageKind } from '../../../preload/index';
import { useCodesignStore } from '../store';
import { AddCustomProviderModal } from './AddCustomProviderModal';
import { SshProfileModal } from './SshProfileModal';

type Tab = 'models' | 'appearance' | 'storage' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; icon: typeof Cpu }> = [
  { id: 'models', icon: Cpu },
  { id: 'appearance', icon: Palette },
  { id: 'storage', icon: FolderOpen },
  { id: 'advanced', icon: Sliders },
];

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Tiny primitives 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻?

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

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Models tab 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍?

function ProviderOverflowMenu({
  isActive,
  hasError,
  onTestConnection,
  onDelete,
  label,
}: {
  isActive: boolean;
  hasError: boolean;
  onTestConnection: () => void;
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
  onRowChanged,
}: {
  row: ProviderRow;
  config: OnboardingState | null;
  onDelete: (p: string) => void;
  onActivate: (p: string) => void;
  onRowChanged: (row: ProviderRow) => void;
}) {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const label = row.label ?? row.provider;
  const hasError = row.error !== undefined;

  const stateClass = hasError
    ? 'border-[var(--color-error)] bg-[var(--color-surface)]'
    : row.isActive
      ? 'border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface)]';

  async function handleTestConnection() {
    if (!window.codesign) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.connectionFailed'),
        description: t('settings.common.unknownError'),
      });
      return;
    }
    try {
      const res = await window.codesign.connection.testProvider(row.provider);
      if (res.ok) {
        pushToast({ variant: 'success', title: t('settings.providers.toast.connectionOk') });
      } else {
        pushToast({
          variant: 'error',
          title: t('settings.providers.toast.connectionFailed'),
          description: res.hint || res.message,
        });
      }
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.connectionFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
            onDelete={() => onDelete(row.provider)}
            label={label}
          />
        </div>
      </div>

      {row.isActive && !hasError && config !== null && (
        <ActiveModelSelector config={config} provider={row.provider} />
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

function ActiveModelSelector({
  config,
  provider,
}: {
  config: OnboardingState;
  provider: string;
}) {
  const t = useT();
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);

  const [primary, setPrimary] = useState(config.modelPrimary ?? '');
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setPrimary(config.modelPrimary ?? '');
  }, [config.modelPrimary]);

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
      const updated = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: next,
      });
      setConfig(updated);
      return true;
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.modelSaveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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

  const options =
    models !== null && models.length > 0 ? models.map((m) => ({ value: m, label: m })) : null;

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
  const [saving, setSaving] = useState(false);
  // Controlled local state 闂?optimistic so the dropdown reflects the user's
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
      // in-flight save 闂?otherwise a newer pick is about to land.
      if (seq === saveSeq.current) setCurrent(prev);
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.reasoningSaveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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

const DISMISSED_BANNER_PREFIX = 'open-codesign:settings:dismissed-import-banner:';
function readDismissed(kind: 'codex' | 'claudeCode'): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_BANNER_PREFIX + kind) === '1';
  } catch {
    return false;
  }
}
function writeDismissed(kind: 'codex' | 'claudeCode'): void {
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
}: {
  label: string;
  onImport: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent-tint)] px-3 py-2 flex items-center gap-2">
      <span className="flex-1 text-[var(--text-xs)] text-[var(--color-text-primary)]">{label}</span>
      <button
        type="button"
        onClick={onImport}
        className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity"
      >
        {t('settings.providers.import.action')}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        {t('settings.providers.import.dismiss')}
      </button>
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
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [externalConfigs, setExternalConfigs] = useState<{
    codex?: { count: number } | undefined;
    claudeCode?: { baseUrl: string } | undefined;
  } | null>(null);

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
    void window.codesign.config
      .detectExternalConfigs()
      .then((detected) => {
        const dismissedCodex = readDismissed('codex');
        const dismissedClaudeCode = readDismissed('claudeCode');
        setExternalConfigs({
          ...(detected.codex !== undefined && !dismissedCodex
            ? { codex: { count: detected.codex.providers.length } }
            : {}),
          ...(detected.claudeCode?.provider && !dismissedClaudeCode
            ? { claudeCode: { baseUrl: detected.claudeCode.provider.baseUrl } }
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
      pushToast({
        variant: 'error',
        title: t('settings.providers.import.failed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    }
  }

  async function handleImportClaudeCode() {
    if (!window.codesign) return;
    try {
      await window.codesign.config.importClaudeCodeConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, claudeCode: undefined }));
      await reloadRows();
      pushToast({ variant: 'success', title: t('settings.providers.import.claudeCodeDone') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.import.failed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.deleteFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
      setConfig(next);
      const updatedRows = await window.codesign.settings.listProviders();
      setRows(updatedRows);
      pushToast({
        variant: 'success',
        title: t('settings.providers.toast.switchedTo', { label }),
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.switchFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    }
  }

  return (
    <>
      {showAddCustom && (
        <AddCustomProviderModal
          onSave={async () => {
            setShowAddCustom(false);
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => setShowAddCustom(false)}
        />
      )}

      <div className="space-y-[var(--space-3)]">
        {externalConfigs !== null &&
          (externalConfigs.codex !== undefined || externalConfigs.claudeCode !== undefined) && (
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
              {externalConfigs.claudeCode !== undefined && (
                <ImportBanner
                  label={t('settings.providers.import.claudeCodeFound', {
                    baseUrl: externalConfigs.claudeCode.baseUrl,
                  })}
                  onImport={handleImportClaudeCode}
                  onDismiss={() => {
                    writeDismissed('claudeCode');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, claudeCode: undefined },
                    );
                  }}
                />
              )}
            </div>
          )}
        <div className="flex items-center justify-between gap-[var(--space-3)] min-h-[var(--size-control-sm)]">
          <SectionTitle>{t('settings.providers.sectionTitle')}</SectionTitle>
          <AddProviderMenu
            open={showAddMenu}
            setOpen={setShowAddMenu}
            hasClaudeCodeImported={rows.some((r) => r.provider === 'claude-code-imported')}
            onImportCodex={() => {
              setShowAddMenu(false);
              void handleImportCodex();
            }}
            onImportClaudeCode={() => {
              setShowAddMenu(false);
              void handleImportClaudeCode();
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

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Appearance tab 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?

/**
 * Applies a locale change end-to-end:
 *   1. Persists it via the IPC bridge (writes to disk on the main process)
 *   2. Changes the active i18next language so React components re-render
 *
 * Requires a connected `localeApi` 闂?callers must guard against a missing
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

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Storage tab 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍?

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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
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

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Advanced tab 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕?

function AdvancedTab() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const config = useCodesignStore((s) => s.config);
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [prefs, setPrefs] = useState<Preferences>({
    updateChannel: 'stable',
    generationTimeoutSec: 120,
  });
  const [showSshModal, setShowSshModal] = useState(false);
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);

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

  async function handleTestSshProfile(id: string) {
    if (!window.codesign?.remote) return;
    setTestingProfileId(id);
    try {
      await window.codesign.remote.testSavedProfile(id);
      pushToast({ variant: 'success', title: 'SSH 连接正常' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'SSH 连接失败',
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    } finally {
      setTestingProfileId(null);
    }
  }

  async function handleDeleteSshProfile(id: string) {
    if (!window.codesign?.remote) return;
    try {
      const next = await window.codesign.remote.deleteProfile(id);
      completeOnboarding(next);
      pushToast({ variant: 'success', title: 'SSH Profile 已删除' });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: '删除 SSH Profile 失败',
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

      <div className="pt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionTitle>SSH 配置</SectionTitle>
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
              远程附件、远程设计系统和 HTML 写回都会复用这里保存的连接配置。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSshModal(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加 SSH
          </button>
        </div>

        {config?.sshProfiles?.length ? (
          <div className="space-y-2">
            {config.sshProfiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                    {profile.name}
                  </p>
                  <p className="truncate text-[var(--text-xs)] text-[var(--color-text-muted)]">
                    {profile.username}@{profile.host}:{profile.port}
                    {profile.basePath ? ` · 根目录 ${profile.basePath}` : ''}
                    {profile.authMethod === 'privateKey' ? ' · 私钥' : ' · 密码'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestSshProfile(profile.id)}
                    className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    {testingProfileId === profile.id ? '测试中…' : '测试'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSshProfile(profile.id)}
                    className="h-7 px-3 rounded-[var(--radius-sm)] border border-[var(--color-error)] text-[var(--text-xs)] text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-[var(--color-on-accent)] transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[var(--text-sm)] text-[var(--color-text-muted)]">
            还没有保存任何 SSH Profile。
          </p>
        )}
      </div>

      {showSshModal ? (
        <SshProfileModal
          existingProfiles={config?.sshProfiles ?? []}
          onClose={() => setShowSshModal(false)}
          onSaved={(next) => {
            completeOnboarding(next);
            pushToast({ variant: 'success', title: 'SSH Profile 已保存' });
          }}
        />
      ) : null}
    </div>
  );
}

// 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁?Shell 闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹曢梻浣稿暱閸樻粓宕戦幘缁樼厓闁稿繐顦禍楣冩⒑閸愭彃甯ㄩ柛瀣崌閺屽秹宕楁径濠佸闂備礁鍟块崢婊堝磻閹剧粯鐓冮柛蹇擃槸娴滈箖姊洪崘鎻掑辅闁稿鎹囬弻宥夊礂婢跺﹣澹?

export function Settings() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('models');

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
  onImportCodex: () => void;
  onImportClaudeCode: () => void;
  onAddCustom: () => void;
}

function AddProviderMenu({
  open,
  setOpen,
  hasClaudeCodeImported,
  onImportCodex,
  onImportClaudeCode,
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
