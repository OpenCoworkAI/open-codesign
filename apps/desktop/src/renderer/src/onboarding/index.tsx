import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from '../store';
import { ChooseModel } from './ChooseModel';
import { PasteKey } from './PasteKey';
import { Welcome } from './Welcome';

type Step = 'welcome' | 'paste' | 'model';

export function Onboarding() {
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<SupportedOnboardingProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleValidated(p: SupportedOnboardingProvider, key: string) {
    setProvider(p);
    setApiKey(key);
    setStep('model');
  }

  async function handleConfirm(modelPrimary: string, modelFast: string) {
    if (provider === null) return;
    if (!window.codesign) {
      setErrorMessage('Renderer is not connected to the main process.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      const next = await window.codesign.onboarding.saveKey({
        provider,
        apiKey,
        modelPrimary,
        modelFast,
      });
      completeOnboarding(next);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-[var(--color-background)] px-6 py-8">
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] p-8 flex flex-col gap-6">
        <header className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[var(--color-accent)]" />
          <span className="font-semibold text-[var(--color-text-primary)]">open-codesign</span>
          <span className="ml-auto text-xs text-[var(--color-text-muted)]">
            Step {stepIndex(step)} of 3
          </span>
        </header>

        {step === 'welcome' ? (
          <Welcome
            onPickKey={() => setStep('paste')}
            onPickFreeTier={() => {
              setProvider('openrouter');
              setStep('paste');
            }}
            ollamaDetected={false}
          />
        ) : null}
        {step === 'paste' ? (
          <PasteKey onValidated={handleValidated} onBack={() => setStep('welcome')} />
        ) : null}
        {step === 'model' && provider !== null ? (
          <ChooseModel
            provider={provider}
            saving={saving}
            errorMessage={errorMessage}
            onConfirm={handleConfirm}
            onBack={() => setStep('paste')}
          />
        ) : null}
      </div>
    </div>
  );
}

function stepIndex(step: Step): number {
  if (step === 'welcome') return 1;
  if (step === 'paste') return 2;
  return 3;
}

// Re-export for convenience.
export { PROVIDER_SHORTLIST };
