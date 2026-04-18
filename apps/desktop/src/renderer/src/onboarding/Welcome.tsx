import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { ExternalLink, KeyRound, Rocket, Server } from 'lucide-react';

interface WelcomeProps {
  onPickKey: () => void;
  onPickFreeTier: () => void;
  ollamaDetected: boolean;
}

export function Welcome({ onPickKey, onPickFreeTier, ollamaDetected }: WelcomeProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
          Welcome to open-codesign
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Pick how you want to power your designs. You can change this later in Settings.
        </p>
      </div>

      <div className="grid gap-3">
        <PathButton
          icon={<Rocket className="w-5 h-5 text-[var(--color-accent)]" />}
          title="Try free now"
          subtitle="OpenRouter free tier — paste an OpenRouter key, then pick a free model."
          onClick={onPickFreeTier}
        />
        <PathButton
          icon={<KeyRound className="w-5 h-5 text-[var(--color-accent)]" />}
          title="Use my API key"
          subtitle="Anthropic, OpenAI, or OpenRouter. Auto-detected from the key prefix."
          onClick={onPickKey}
        />
        {ollamaDetected ? (
          <PathButton
            icon={<Server className="w-5 h-5 text-[var(--color-text-muted)]" />}
            title="Use local model (Ollama detected)"
            subtitle="Coming in v0.2 — Ollama integration is on the roadmap."
            disabled
          />
        ) : null}
      </div>

      <div className="text-xs text-[var(--color-text-muted)] flex flex-wrap gap-x-4 gap-y-1">
        {(
          Object.values(PROVIDER_SHORTLIST) as Array<
            (typeof PROVIDER_SHORTLIST)[SupportedOnboardingProvider]
          >
        ).map((p) => (
          <a
            key={p.provider}
            href={p.keyHelpUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            How to get a {p.label} key <ExternalLink className="w-3 h-3" />
          </a>
        ))}
      </div>
    </div>
  );
}

interface PathButtonProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
}

function PathButton({ icon, title, subtitle, onClick, disabled }: PathButtonProps) {
  return (
    <Button
      variant="secondary"
      size="lg"
      onClick={onClick}
      disabled={disabled}
      className="!h-auto !justify-start text-left py-4"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col items-start gap-0.5">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
        <span className="text-xs text-[var(--color-text-muted)] font-normal">{subtitle}</span>
      </span>
    </Button>
  );
}
