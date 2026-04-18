import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { useState } from 'react';

interface ChooseModelProps {
  provider: SupportedOnboardingProvider;
  saving: boolean;
  errorMessage: string | null;
  onConfirm: (modelPrimary: string, modelFast: string) => void;
  onBack: () => void;
}

export function ChooseModel({
  provider,
  saving,
  errorMessage,
  onConfirm,
  onBack,
}: ChooseModelProps) {
  const shortlist = PROVIDER_SHORTLIST[provider];
  const [modelPrimary, setModelPrimary] = useState(shortlist.defaultPrimary);
  const [modelFast, setModelFast] = useState(shortlist.defaultFast);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[20px] font-semibold text-[var(--color-text-primary)] tracking-[-0.01em] leading-[1.2]">
          Pick default models
        </h2>
        <p className="text-[14px] text-[var(--color-text-secondary)] leading-[1.55]">
          Recommended starters for {shortlist.label}. Switchable per-design later.
        </p>
      </div>

      <ModelPicker
        label="Primary design model"
        hint="Used for full design generation."
        value={modelPrimary}
        options={shortlist.primary}
        onChange={setModelPrimary}
      />
      <ModelPicker
        label="Fast completion model"
        hint="Used for quick edits and inline tweaks."
        value={modelFast}
        options={shortlist.fast}
        onChange={setModelFast}
      />

      <p className="text-[12px] text-[var(--color-text-muted)] leading-[1.5]">
        Estimated cost: ~$0.01–0.05 per design session (varies by provider and prompt length).
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
          onClick={() => onConfirm(modelPrimary, modelFast)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Finish'}
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
  return (
    <label className="flex flex-col gap-2">
      <span
        className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] font-medium"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: 'var(--font-mono)' }}
        className="w-full h-[40px] px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <span className="text-[12px] text-[var(--color-text-muted)] leading-[1.4]">{hint}</span>
    </label>
  );
}
