import { useT } from '@open-codesign/i18n';
import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Button, Tooltip } from '@open-codesign/ui';
import { useEffect, useId, useState } from 'react';

const OPENROUTER_FREE_MODEL = 'openrouter/free';

interface ChooseModelProps {
  provider: SupportedOnboardingProvider;
  preferFreeTier?: boolean;
  baseUrl: string | null;
  saving: boolean;
  errorMessage: string | null;
  onConfirm: (modelPrimary: string) => void;
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
  const t = useT();
  const shortlist = PROVIDER_SHORTLIST[provider];
  const useFreeTierDefaults = provider === 'openrouter' && preferFreeTier;
  const primaryOptions = withFreeTierSuggestion(shortlist.primary, useFreeTierDefaults);
  const [modelPrimary, setModelPrimary] = useState(
    getDefaultModel(shortlist.defaultPrimary, useFreeTierDefaults),
  );

  useEffect(() => {
    setModelPrimary(getDefaultModel(shortlist.defaultPrimary, useFreeTierDefaults));
  }, [shortlist.defaultPrimary, useFreeTierDefaults]);

  const trimmedPrimary = modelPrimary.trim();
  const canFinish = trimmedPrimary.length > 0 && !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-text-primary)] tracking-[var(--tracking-heading)] leading-[var(--leading-heading)]">
          {t('onboarding.choose.title')}
        </h2>
        <p className="text-[var(--text-base)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          {t('onboarding.choose.description')}
        </p>
      </div>

      <ModelPicker
        label={t('onboarding.choose.primary')}
        hint={
          useFreeTierDefaults
            ? t('onboarding.choose.primaryHintFree')
            : t('onboarding.choose.primaryHint')
        }
        value={modelPrimary}
        options={primaryOptions}
        onChange={setModelPrimary}
      />

      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-snug)]">
        {baseUrl !== null ? (
          <>
            {t('onboarding.choose.customBaseUrl', { url: baseUrl })}
            <br />
          </>
        ) : null}
        {useFreeTierDefaults
          ? t('onboarding.choose.costNoteFree')
          : t('onboarding.choose.costNote')}
      </p>

      {errorMessage !== null ? (
        <p className="text-[var(--text-sm)] text-[var(--color-error)]">{errorMessage}</p>
      ) : null}

      <div className="flex justify-between gap-2 pt-2">
        <Tooltip label={saving ? t('disabledReason.savingInProgress') : undefined} side="top">
          <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
            {t('onboarding.choose.back')}
          </Button>
        </Tooltip>
        <Tooltip
          label={
            !canFinish
              ? saving
                ? t('disabledReason.savingInProgress')
                : t('disabledReason.enterBothModels')
              : undefined
          }
          side="top"
        >
          <Button
            type="button"
            variant="primary"
            onClick={() => onConfirm(trimmedPrimary)}
            disabled={!canFinish}
          >
            {saving ? t('onboarding.choose.saving') : t('onboarding.choose.finish')}
          </Button>
        </Tooltip>
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
        className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
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
        className="w-full h-[var(--size-control-md)] px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
              className={`px-2.5 h-[var(--size-control-sm)] rounded-full border text-[var(--text-xs)] transition-colors ${
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

      <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
        {hint}
      </span>
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
