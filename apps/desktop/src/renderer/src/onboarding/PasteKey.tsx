import {
  PROVIDER_SHORTLIST,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ValidateKeyError, ValidateKeyResult } from '../../../preload/index';

const VALIDATE_DEBOUNCE_MS = 500;

type ValidationState =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'validating' }
  | { kind: 'ok'; modelCount: number }
  | { kind: 'error'; code: ValidateKeyError['code'] | 'unsupported'; message: string };

interface PasteKeyProps {
  onValidated: (provider: SupportedOnboardingProvider, apiKey: string) => void;
  onBack: () => void;
}

export function PasteKey({ onValidated, onBack }: PasteKeyProps) {
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<SupportedOnboardingProvider | null>(null);
  const [state, setState] = useState<ValidationState>({ kind: 'idle' });
  const reqIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = apiKey.trim();

  useEffect(() => {
    if (trimmed.length === 0) {
      setProvider(null);
      setState({ kind: 'idle' });
      return;
    }

    setState({ kind: 'detecting' });
    const reqId = ++reqIdRef.current;

    const handle = window.setTimeout(async () => {
      if (!window.codesign) {
        setState({
          kind: 'error',
          code: 'network',
          message: 'Renderer is not connected to the main process.',
        });
        return;
      }
      let detected: string | null;
      try {
        detected = await window.codesign.detectProvider(trimmed);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setState({
          kind: 'error',
          code: 'network',
          message: err instanceof Error ? err.message : 'Provider detection failed.',
        });
        return;
      }
      if (reqId !== reqIdRef.current) return;

      if (detected === null) {
        setProvider(null);
        setState({
          kind: 'error',
          code: 'unsupported',
          message:
            'Unrecognized key prefix. Supported: sk-ant- (Anthropic), sk- (OpenAI), sk-or- (OpenRouter).',
        });
        return;
      }
      if (!isSupportedOnboardingProvider(detected)) {
        setProvider(null);
        setState({
          kind: 'error',
          code: 'unsupported',
          message: `${detected} is not supported in v0.1. Use Anthropic, OpenAI, or OpenRouter.`,
        });
        return;
      }
      setProvider(detected);
      setState({ kind: 'validating' });

      let result: ValidateKeyResult | ValidateKeyError;
      try {
        result = await window.codesign.onboarding.validateKey({
          provider: detected,
          apiKey: trimmed,
        });
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setState({
          kind: 'error',
          code: 'network',
          message: err instanceof Error ? err.message : 'Validation request failed.',
        });
        return;
      }
      if (reqId !== reqIdRef.current) return;

      if (result.ok) {
        setState({ kind: 'ok', modelCount: result.modelCount });
      } else {
        setState({ kind: 'error', code: result.code, message: result.message });
      }
    }, VALIDATE_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [trimmed]);

  const helpUrl = useMemo(() => {
    if (provider === null) return null;
    return PROVIDER_SHORTLIST[provider].keyHelpUrl;
  }, [provider]);

  function handleContinue() {
    if (state.kind !== 'ok' || provider === null) return;
    onValidated(provider, trimmed);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-1">
          Paste your API key
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          We auto-detect the provider and validate against /v1/models. Your key is encrypted with
          the OS keychain.
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          API key
        </span>
        <input
          ref={inputRef}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-…  /  sk-…  /  sk-or-…"
          spellCheck={false}
          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-mono text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <StatusLine provider={provider} state={state} helpUrl={helpUrl} />

      <div className="flex justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleContinue}
          disabled={state.kind !== 'ok'}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

interface StatusLineProps {
  provider: SupportedOnboardingProvider | null;
  state: ValidationState;
  helpUrl: string | null;
}

function StatusLine({ provider, state, helpUrl }: StatusLineProps) {
  if (state.kind === 'idle') {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        Paste a key to detect the provider and validate live.
      </p>
    );
  }
  if (state.kind === 'detecting') {
    return <Pending text="Detecting provider…" />;
  }
  if (state.kind === 'validating') {
    return (
      <Pending
        text={`Recognized: ${provider ? PROVIDER_SHORTLIST[provider].label : 'unknown'} — validating…`}
      />
    );
  }
  if (state.kind === 'ok') {
    return (
      <div className="text-sm text-[var(--color-success)] flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>
          Recognized: {provider ? PROVIDER_SHORTLIST[provider].label : 'provider'} — Connected (
          {state.modelCount} models)
        </span>
      </div>
    );
  }
  return (
    <div className="text-sm text-[var(--color-error)] flex flex-col gap-1">
      <span className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{state.message}</span>
      </span>
      {helpUrl !== null ? (
        <a
          href={helpUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-6 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
        >
          How to get a key <ExternalLink className="w-3 h-3" />
        </a>
      ) : null}
    </div>
  );
}

function Pending({ text }: { text: string }) {
  return (
    <div className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{text}</span>
    </div>
  );
}
