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
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-1">
          Pick default models
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
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

      <p className="text-xs text-[var(--color-text-muted)]">
        Estimated cost: ~$0.01–0.05 per design session (varies by provider and prompt length).
      </p>

      {errorMessage !== null ? (
        <p className="text-sm text-[var(--color-error)]">{errorMessage}</p>
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
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <span className="text-xs text-[var(--color-text-muted)]">{hint}</span>
    </label>
  );
}
