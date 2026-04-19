import { useT } from '@open-codesign/i18n';
import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Wordmark } from '@open-codesign/ui';
import { useState } from 'react';
import { LanguageToggle } from '../components/LanguageToggle';
import { useCodesignStore } from '../store';
import { ChooseModel } from './ChooseModel';
import { PasteKey } from './PasteKey';
import { Welcome } from './Welcome';

type Step = 'welcome' | 'paste' | 'model';

export function Onboarding() {
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<SupportedOnboardingProvider | null>(null);
  const [preferFreeTier, setPreferFreeTier] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleValidated(p: SupportedOnboardingProvider, key: string, url: string | null) {
    setProvider(p);
    setPreferFreeTier((current) => (p === 'openrouter' ? current : false));
    setApiKey(key);
    setBaseUrl(url);
    setStep('model');
  }

  async function handleConfirm(modelPrimary: string) {
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
        ...(baseUrl !== null ? { baseUrl } : {}),
      });
      completeOnboarding(next);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save key.');
    } finally {
      setSaving(false);
    }
  }

  const idx = stepIndex(step);

  return (
    <div className="h-full flex items-center justify-center bg-[var(--color-background)] px-6 py-8 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, var(--color-accent-soft), transparent 70%)',
        }}
      />
      <div className="relative w-full max-w-[480px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] p-8 flex flex-col gap-6">
        <header className="flex items-center justify-between">
          <Wordmark badge="pre-alpha" />
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <Stepper current={idx} total={3} />
          </div>
        </header>

        {step === 'welcome' ? (
          <Welcome
            onPickKey={() => {
              setPreferFreeTier(false);
              setStep('paste');
            }}
            onPickFreeTier={() => {
              setPreferFreeTier(true);
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
            preferFreeTier={preferFreeTier}
            baseUrl={baseUrl}
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

function Stepper({ current, total }: { current: number; total: number }) {
  const t = useT();
  const label = t('onboarding.stepperLabel', { current, total });
  return (
    <div
      tabIndex={-1}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={label}
      aria-valuetext={label}
      className="flex items-center gap-2"
    >
      <span
        className="text-[var(--text-xs)] text-[var(--color-text-muted)] tracking-[var(--tracking-label)]"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {current.toString().padStart(2, '0')} / {total.toString().padStart(2, '0')}
      </span>
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stepper dots are positional
            key={i}
            className={`h-[3px] rounded-full transition-[width,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              i < current
                ? 'w-[14px] bg-[var(--color-accent)]'
                : 'w-[6px] bg-[var(--color-border-strong)]'
            }`}
          />
        ))}
      </span>
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
