import { useT } from '@open-codesign/i18n';
import { type WireApi, detectWireFromBaseUrl } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { AlertCircle, CheckCircle, Loader2, X } from 'lucide-react';
import { useState } from 'react';

interface Props {
  onSave: () => void;
  onClose: () => void;
  /** When true, render as the primary/active provider after save. */
  initialSetAsActive?: boolean;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; modelCount: number }
  | { kind: 'error'; message: string };

/**
 * Minimal Custom Provider form — wire-agnostic endpoint onboarding.
 * Deliberately barebones (native form + FormData-ish accessors, no schema),
 * per the v3 brief. Advanced headers/queryParams defer to a later pass.
 */
export function AddCustomProviderModal({ onSave, onClose, initialSetAsActive = true }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [wire, setWire] = useState<WireApi>('openai-chat');
  const [wireAuto, setWireAuto] = useState(true);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleBaseUrlChange(v: string) {
    setBaseUrl(v);
    if (wireAuto) setWire(detectWireFromBaseUrl(v));
    setTest({ kind: 'idle' });
  }

  function handleWireChange(v: WireApi) {
    setWire(v);
    setWireAuto(false);
  }

  async function handleTest() {
    if (!window.codesign?.config) return;
    if (baseUrl.trim().length === 0 || apiKey.trim().length === 0) return;
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
      const slug = slugify(name);
      const id = `custom-${slug}-${Date.now().toString(36).slice(-4)}`;
      await window.codesign.config.addProvider({
        id,
        name: name.trim() || id,
        wire,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        defaultModel: defaultModel.trim(),
        setAsActive: initialSetAsActive,
      });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canTest = baseUrl.trim().length > 0 && test.kind !== 'testing';
  const canSave = canTest && defaultModel.trim().length > 0 && name.trim().length > 0 && !saving;

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: same rationale as AddProviderModal — native <dialog> top-layer conflicts with our overlay stack
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.providers.custom.title')}
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
            {t('settings.providers.custom.title')}
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

        <Field label={t('settings.providers.custom.name')}>
          <TextInput value={name} onChange={setName} placeholder="My Provider" />
        </Field>

        <Field label={t('settings.providers.custom.baseUrl')}>
          <TextInput
            value={baseUrl}
            onChange={handleBaseUrlChange}
            placeholder="https://api.example.com/v1"
          />
        </Field>

        <Field label={t('settings.providers.custom.apiKey')}>
          <TextInput value={apiKey} onChange={setApiKey} type="password" placeholder="sk-..." />
        </Field>

        <Field label={t('settings.providers.custom.defaultModel')}>
          <TextInput value={defaultModel} onChange={setDefaultModel} placeholder="model-name" />
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
            {t('settings.providers.custom.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
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
