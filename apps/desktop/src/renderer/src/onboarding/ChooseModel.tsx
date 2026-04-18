import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { useEffect, useId, useState } from 'react';

const OPENROUTER_FREE_MODEL = 'openrouter/free';

interface ChooseModelProps {
  provider: SupportedOnboardingProvider;
  preferFreeTier?: boolean;
  baseUrl: string | null;
  saving: boolean;
  errorMessage: string | null;
  onConfirm: (modelPrimary: string, modelFast: string) => void;
  onBack: () => void;
}

export function ChooseModel({
  provider,
  preferFreeTier = false,
  baseUrl,
  saving,
  errorMessage,
  onConfirm,
  onBack,
}: ChooseModelProps) {
  const shortlist = PROVIDER_SHORTLIST[provider];
  const useFreeTierDefaults = provider === 'openrouter' && preferFreeTier;
  const primaryOptions = withFreeTierSuggestion(shortlist.primary, useFreeTierDefaults);
  const fastOptions = withFreeTierSuggestion(shortlist.fast, useFreeTierDefaults);
  const [modelPrimary, setModelPrimary] = useState(
    getDefaultModel(shortlist.defaultPrimary, useFreeTierDefaults),
  );
  const [modelFast, setModelFast] = useState(
    getDefaultModel(shortlist.defaultFast, useFreeTierDefaults),
  );

  useEffect(() => {
    setModelPrimary(getDefaultModel(shortlist.defaultPrimary, useFreeTierDefaults));
    setModelFast(getDefaultModel(shortlist.defaultFast, useFreeTierDefaults));
  }, [shortlist.defaultPrimary, shortlist.defaultFast, useFreeTierDefaults]);

  const trimmedPrimary = modelPrimary.trim();
  const trimmedFast = modelFast.trim();
  const canFinish = trimmedPrimary.length > 0 && trimmedFast.length > 0 && !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)] tracking-[-0.01em] leading-[1.2]">
          Pick default models
        </h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-[1.55]">
          Start with a recommendation or enter any provider-specific model ID. You can switch these
          per design later.
        </p>
      </div>

      <ModelPicker
        label="Primary design model"
        hint={
          useFreeTierDefaults
            ? 'Free path starts on openrouter/free, but you can enter any OpenRouter model ID.'
            : 'Used for full design generation.'
        }
        value={modelPrimary}
        options={primaryOptions}
        onChange={setModelPrimary}
      />
      <ModelPicker
        label="Fast completion model"
        hint={
          useFreeTierDefaults
            ? 'Keep openrouter/free for lowest cost, or replace it with a faster custom choice.'
            : 'Used for quick edits and inline tweaks.'
        }
        value={modelFast}
        options={fastOptions}
        onChange={setModelFast}
      />

      {baseUrl !== null ? (
        <p className="text-[12px] text-[var(--color-text-muted)] leading-[1.5]">
          Custom base URL: <span style={{ fontFamily: 'var(--font-mono)' }}>{baseUrl}</span>
        </p>
      ) : null}

      <p className="text-[12px] text-[var(--color-text-muted)] leading-[1.5]">
        {useFreeTierDefaults
          ? 'OpenRouter free routing availability can change. If a free route is unavailable, type another model ID here.'
          : 'Estimated cost varies by provider, chosen model, and prompt length.'}
      </p>

      {errorMessage !== null ? (
        <p className="text-[13px] text-[var(--color-error)]">{errorMessage}</p>
      ) : null}

      <div className="flex justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => onConfirm(trimmedPrimary, trimmedFast)}
          disabled={!canFinish}
        >
          {saving ? 'Saving...' : 'Finish'}
        </Button>
      </div>
    </div>
  );
}

interface ModelPickerProps {
  label: string;
  hint: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
}

function ModelPicker({ label, hint, value, options, onChange }: ModelPickerProps) {
  const inputId = useId();
  const datalistId = useId();

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </label>

      <input
        id={inputId}
        type="text"
        value={value}
        list={datalistId}
        onChange={(e) => onChange(e.target.value)}
        placeholder={options[0]}
        spellCheck={false}
        style={{ fontFamily: 'var(--font-mono)' }}
        className="w-full h-[40px] px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      />
      <datalist id={datalistId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>

      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value.trim() === opt;

          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`px-2.5 h-[28px] rounded-full border text-[11px] transition-colors ${
                selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]'
              }`}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <span className="text-[12px] text-[var(--color-text-muted)] leading-[1.4]">{hint}</span>
    </div>
  );
}

function getDefaultModel(defaultModel: string, useFreeTierDefaults: boolean): string {
  return useFreeTierDefaults ? OPENROUTER_FREE_MODEL : defaultModel;
}

function withFreeTierSuggestion(options: string[], useFreeTierDefaults: boolean): string[] {
  if (!useFreeTierDefaults) return options;
  return [OPENROUTER_FREE_MODEL, ...options.filter((opt) => opt !== OPENROUTER_FREE_MODEL)];
}
