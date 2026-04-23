import { useT } from '@open-codesign/i18n';
import { type WireApi, canonicalBaseUrl, detectWireFromBaseUrl } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { AlertCircle, Check, CheckCircle, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';

interface Props {
  onSave: () => void;
  onClose: () => void;
  /** When true, render as the primary/active provider after save. */
  initialSetAsActive?: boolean;
  /**
   * Pre-fill the form. Used by Settings to jump OAuth-only users straight
   * into a focused "paste your Anthropic key" flow instead of making them
   * rediscover the fields. Users can still edit every field before saving.
   */
  initialValues?: {
    name?: string;
    baseUrl?: string;
    wire?: WireApi;
    defaultModel?: string;
  };
  /**
   * Edit-mode: pre-fill every field from an existing provider and save via
   * `updateProvider` (keeps id stable, rotates secret only when user types
   * a new key). When undefined, falls back to create-mode.
   */
  editTarget?: {
    id: string;
    name: string;
    baseUrl: string;
    wire: WireApi;
    defaultModel: string;
    builtin: boolean;
    /** When true, lock baseUrl/wire so users can't accidentally break a
     *  builtin. Builtins still allow API key + defaultModel edits. */
    lockEndpoint: boolean;
    /** Display mask of existing key (e.g. "sk-ant-***xyz9") — shown as
     *  placeholder so user knows there's a stored key, and an empty submit
     *  doesn't wipe it. */
    keyMask?: string;
  };
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; modelCount: number }
  | { kind: 'error'; message: string };

type DiscoveryState =
  | { kind: 'idle' }
  | { kind: 'discovering' }
  | { kind: 'found'; models: string[] }
  | { kind: 'failed' };

/** Priority-ordered model selection after a successful discovery. */
function pickBestModel(models: string[]): string {
  const priorities: RegExp[] = [
    /^claude-sonnet-4-5/,
    /^claude-opus/,
    /^claude-sonnet/,
    /^gemini-2\.5-pro$|^gemini-3.*pro/,
    /^gpt-5/,
  ];
  for (const pattern of priorities) {
    const match = models.find((m) => pattern.test(m));
    if (match !== undefined) return match;
  }
  return models[0] ?? '';
}

/**
 * Minimal Custom Provider form — wire-agnostic endpoint onboarding.
 * Deliberately barebones (native form + FormData-ish accessors, no schema),
 * per the v3 brief. Advanced headers/queryParams defer to a later pass.
 */
export function AddCustomProviderModal({
  onSave,
  onClose,
  initialSetAsActive = true,
  initialValues,
  editTarget,
}: Props) {
  const t = useT();
  const isEdit = editTarget !== undefined;
  const lockEndpoint = editTarget?.lockEndpoint === true;
  const [name, setName] = useState(editTarget?.name ?? initialValues?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(editTarget?.baseUrl ?? initialValues?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(
    editTarget?.defaultModel ?? initialValues?.defaultModel ?? '',
  );
  const [wire, setWire] = useState<WireApi>(
    editTarget?.wire ?? initialValues?.wire ?? 'openai-chat',
  );
  // In edit mode we trust the stored wire; in create mode we only auto-detect
  // if the caller didn't pin one.
  const [wireAuto, setWireAuto] = useState(!isEdit && initialValues?.wire === undefined);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [discovery, setDiscovery] = useState<DiscoveryState>({ kind: 'idle' });
  // When true, user explicitly chose to type a model name instead of picking from the dropdown.
  const [manualModel, setManualModel] = useState(false);
  // Track whether user has explicitly typed/picked a model so auto-pick doesn't override it.
  const userPickedModel = useRef(false);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discoverySeq = useRef(0);

  function scheduleDiscovery(currentBaseUrl: string, currentWire: WireApi) {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    if (!currentBaseUrl.trim().match(/^https?:\/\//)) {
      discoverySeq.current += 1;
      setDiscovery({ kind: 'idle' });
      return;
    }
    debounceTimer.current = setTimeout(() => {
      void runDiscovery(currentBaseUrl, currentWire);
    }, 500);
  }

  async function runDiscovery(currentBaseUrl: string, currentWire: WireApi) {
    if (!window.codesign?.config) return;
    const seq = ++discoverySeq.current;
    setDiscovery({ kind: 'discovering' });
    try {
      const res = await window.codesign.config.testEndpoint({
        wire: currentWire,
        baseUrl: currentBaseUrl.trim(),
        apiKey: '',
      });
      if (seq !== discoverySeq.current) return;
      if (res.ok && res.models.length > 0) {
        setDiscovery({ kind: 'found', models: res.models });
        if (!userPickedModel.current) {
          const best = pickBestModel(res.models);
          setDefaultModel(best);
        }
      } else {
        setDiscovery({ kind: 'failed' });
      }
    } catch {
      if (seq === discoverySeq.current) setDiscovery({ kind: 'failed' });
    }
  }

  function handleBaseUrlChange(v: string) {
    setBaseUrl(v);
    if (wireAuto) setWire(detectWireFromBaseUrl(v));
    setTest({ kind: 'idle' });
    scheduleDiscovery(v, wireAuto ? detectWireFromBaseUrl(v) : wire);
  }

  function handleApiKeyChange(v: string) {
    setApiKey(v);
  }

  function handleWireChange(v: WireApi) {
    setWire(v);
    setWireAuto(false);
    scheduleDiscovery(baseUrl, v);
  }

  function handleModelSelect(v: string) {
    setDefaultModel(v);
    userPickedModel.current = true;
  }

  function handleModelTextChange(v: string) {
    setDefaultModel(v);
    userPickedModel.current = v.length > 0;
  }

  async function handleTest() {
    if (!window.codesign?.config) return;
    if (baseUrl.trim().length === 0) return;
    setTest({ kind: 'testing' });
    try {
      const res = await window.codesign.config.testEndpoint({
        wire,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      });
      if (res.ok) setTest({ kind: 'ok', modelCount: res.modelCount });
      else setTest({ kind: 'error', message: res.message });
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleSave() {
    if (!window.codesign?.config) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit && editTarget !== undefined) {
        // Edit mode: reuse id, rotate secret only when user typed something.
        // Omitting `apiKey` leaves the stored secret untouched — matching the
        // "leave empty to keep current key" UX hinted at by the mask placeholder.
        const update: Parameters<NonNullable<typeof window.codesign.config.updateProvider>>[0] = {
          id: editTarget.id,
        };
        if (name.trim() !== editTarget.name) update.name = name.trim() || editTarget.id;
        if (defaultModel.trim() !== editTarget.defaultModel) {
          update.defaultModel = defaultModel.trim();
        }
        if (!lockEndpoint) {
          if (baseUrl.trim() !== editTarget.baseUrl) {
            update.baseUrl = canonicalBaseUrl(baseUrl.trim(), wire);
          }
          if (wire !== editTarget.wire) update.wire = wire;
        }
        const typedKey = apiKey.trim();
        if (typedKey.length > 0) update.apiKey = typedKey;
        await window.codesign.config.updateProvider(update);
      } else {
        const slug = slugify(name);
        const id = `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
        await window.codesign.config.addProvider({
          id,
          name: name.trim() || id,
          wire,
          baseUrl: canonicalBaseUrl(baseUrl.trim(), wire),
          apiKey: apiKey.trim(),
          defaultModel: defaultModel.trim(),
          setAsActive: initialSetAsActive,
        });
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canTest = baseUrl.trim().length > 0 && test.kind !== 'testing';
  const canSave = (() => {
    if (saving) return false;
    if (isEdit) {
      // In edit mode, require at least the mandatory fields still hold values
      // — but don't require the user to re-enter the API key.
      return baseUrl.trim().length > 0 && defaultModel.trim().length > 0 && name.trim().length > 0;
    }
    return canTest && defaultModel.trim().length > 0 && name.trim().length > 0;
  })();

  const title = isEdit
    ? t('settings.providers.custom.editTitle')
    : t('settings.providers.custom.title');

  // Show the model dropdown when discovery found models AND user hasn't switched to manual entry.
  const showModelDropdown =
    !manualModel && discovery.kind === 'found' && discovery.models.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
            {title}
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

        {!lockEndpoint && (
          <Field label={t('settings.providers.custom.wire')}>
            <div className="flex gap-3 flex-wrap">
              {(['openai-chat', 'openai-responses', 'anthropic'] as const).map((w) => (
                <label
                  key={w}
                  className="inline-flex items-center gap-1.5 text-[var(--text-xs)] cursor-pointer"
                >
                  <input
                    type="radio"
                    name="wire"
                    value={w}
                    checked={wire === w}
                    onChange={() => handleWireChange(w)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="text-[var(--color-text-secondary)]">
                    {t(`settings.providers.custom.wires.${w}`)}
                  </span>
                </label>
              ))}
            </div>
          </Field>
        )}

        <Field label={t('settings.providers.custom.name')}>
          <TextInput
            value={name}
            onChange={setName}
            placeholder="My Provider"
            disabled={lockEndpoint}
          />
        </Field>

        <Field label={t('settings.providers.custom.baseUrl')}>
          <TextInput
            value={baseUrl}
            onChange={handleBaseUrlChange}
            placeholder="https://api.example.com/v1"
            disabled={lockEndpoint}
          />
        </Field>

        <Field label={t('settings.providers.custom.apiKey')}>
          <TextInput
            value={apiKey}
            onChange={handleApiKeyChange}
            type="password"
            placeholder={
              isEdit && editTarget?.keyMask !== undefined && editTarget.keyMask.length > 0
                ? t('settings.providers.custom.apiKeyEditPlaceholder', {
                    mask: editTarget.keyMask,
                  })
                : 'sk-...'
            }
          />
        </Field>

        <Field
          label={t('settings.providers.custom.defaultModel')}
          inline={
            discovery.kind === 'discovering' ? (
              <span className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('settings.providers.custom.discoveringModels')}
              </span>
            ) : discovery.kind === 'found' ? (
              <span className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-success)]">
                <Check className="w-3 h-3" />
                {t('settings.providers.custom.discoveredModels', {
                  count: discovery.models.length,
                })}
              </span>
            ) : discovery.kind === 'failed' ? (
              <span className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                <AlertCircle className="w-3 h-3" />
                {t('settings.providers.custom.discoveryFailed')}
              </span>
            ) : null
          }
        >
          {showModelDropdown ? (
            <div className="flex items-center gap-2">
              <select
                value={defaultModel}
                onChange={(e) => handleModelSelect(e.target.value)}
                className="flex-1 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {discovery.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setManualModel(true)}
                className="shrink-0 text-[var(--text-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline"
              >
                {t('settings.providers.custom.switchToManual')}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <TextInput
                value={defaultModel}
                onChange={handleModelTextChange}
                placeholder="model-name"
              />
              {manualModel && discovery.kind === 'found' && discovery.models.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManualModel(false)}
                  className="shrink-0 text-[var(--text-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline"
                >
                  {t('settings.providers.custom.switchToDropdown')}
                </button>
              )}
            </div>
          )}
        </Field>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={!canTest}
            className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
          >
            {test.kind === 'testing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : test.kind === 'ok' ? (
              <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" />
            ) : test.kind === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 text-[var(--color-error)]" />
            ) : null}
            {t('settings.providers.custom.test')}
          </button>
          {test.kind === 'ok' && (
            <span className="text-[var(--text-xs)] text-[var(--color-success)]">
              {t('settings.providers.custom.testOk', { count: test.modelCount })}
            </span>
          )}
          {test.kind === 'error' && (
            <span className="text-[var(--text-xs)] text-[var(--color-error)] truncate">
              {test.message}
            </span>
          )}
        </div>

        {error !== null && (
          <p className="text-[var(--text-xs)] text-[var(--color-error)]">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            {isEdit ? t('settings.providers.custom.saveEdit') : t('settings.providers.custom.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  inline,
  children,
}: {
  label: string;
  inline?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
          {label}
        </p>
        {inline !== undefined && <span>{inline}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled === true}
      className="w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-60 disabled:cursor-not-allowed"
    />
  );
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'custom'
  );
}
