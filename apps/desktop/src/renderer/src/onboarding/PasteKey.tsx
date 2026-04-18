import {
  PROVIDER_SHORTLIST,
  PROXY_PRESETS,
  type ProxyPresetId,
  type SupportedOnboardingProvider,
  isSupportedOnboardingProvider,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionTestError,
  ConnectionTestResult,
  ValidateKeyError,
  ValidateKeyResult,
} from '../../../preload/index';

const VALIDATE_DEBOUNCE_MS = 500;

type ValidationState =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'validating' }
  | { kind: 'ok'; modelCount: number }
  | { kind: 'error'; code: ValidateKeyError['code'] | 'unsupported'; message: string };

type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; code: ConnectionTestError['code']; hint: string };

interface PasteKeyProps {
  onValidated: (
    provider: SupportedOnboardingProvider,
    apiKey: string,
    baseUrl: string | null,
  ) => void;
  onBack: () => void;
}

function getErrorHint(code: ConnectionTestError['code']): string {
  switch (code) {
    case '401':
      return 'API key invalid or unauthorized.';
    case '404':
      return 'Base URL path wrong. Try adding /v1 suffix (e.g. https://your-host/v1).';
    case 'ECONNREFUSED':
      return 'Cannot reach base URL. Check domain/port/network.';
    case 'NETWORK':
      return 'Network error. Check your connection.';
    case 'PARSE':
      return 'Unexpected response. View logs at ~/Library/Logs/open-codesign/main.log';
    case 'IPC_BAD_INPUT':
      return 'Invalid input sent to connection test. Check provider / API key / base URL fields.';
  }
}

export function PasteKey({ onValidated, onBack }: PasteKeyProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<ProxyPresetId | ''>('');
  const [provider, setProvider] = useState<SupportedOnboardingProvider | null>(null);
  const [state, setState] = useState<ValidationState>({ kind: 'idle' });
  const [connState, setConnState] = useState<ConnectionState>({ kind: 'idle' });
  const reqIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = apiKey.trim();
  const trimmedBaseUrl = baseUrl.trim();

  function handlePresetChange(presetId: string) {
    if (presetId === '') {
      setSelectedPresetId('');
      setBaseUrl('');
      return;
    }
    const preset = PROXY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id as ProxyPresetId);
    setBaseUrl(preset.baseUrl);
    if (preset.id !== 'custom') {
      setAdvancedOpen(true);
    }
    setConnState({ kind: 'idle' });
  }

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
          ...(trimmedBaseUrl.length > 0 ? { baseUrl: trimmedBaseUrl } : {}),
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
  }, [trimmed, trimmedBaseUrl]);

  async function handleConnectionTest() {
    if (!provider || trimmed.length === 0 || trimmedBaseUrl.length === 0) return;
    if (!window.codesign?.connection) {
      setConnState({
        kind: 'error',
        code: 'NETWORK',
        hint: 'Renderer is not connected to the main process.',
      });
      return;
    }
    setConnState({ kind: 'testing' });
    try {
      const result = await window.codesign.connection.test({
        provider,
        apiKey: trimmed,
        baseUrl: trimmedBaseUrl,
      });
      if (result.ok) {
        setConnState({ kind: 'ok' });
      } else {
        const err = result as ConnectionTestError;
        setConnState({ kind: 'error', code: err.code, hint: getErrorHint(err.code) });
      }
    } catch (err) {
      setConnState({
        kind: 'error',
        code: 'NETWORK',
        hint: err instanceof Error ? err.message : 'Connection test failed.',
      });
    }
  }

  const helpUrl = useMemo(() => {
    if (provider === null) return null;
    return PROVIDER_SHORTLIST[provider].keyHelpUrl;
  }, [provider]);

  function handleContinue() {
    if (state.kind !== 'ok' || provider === null) return;
    onValidated(provider, trimmed, trimmedBaseUrl.length > 0 ? trimmedBaseUrl : null);
  }

  const selectedPreset = PROXY_PRESETS.find((p) => p.id === selectedPresetId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-text-primary)] tracking-[var(--tracking-heading)] leading-[var(--leading-heading)]">
          Paste your API key
        </h2>
        <p className="text-[var(--text-base)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          We auto-detect the provider and validate against /v1/models. Your key is encrypted with
          the OS keychain.
        </p>
      </div>

      {/* Preset selector */}
      <label className="flex flex-col gap-2">
        <span
          className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Preset
        </span>
        <select
          value={selectedPresetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] appearance-none cursor-pointer"
        >
          <option value="">-- choose a preset --</option>
          {PROXY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
              {preset.notes ? ` — ${preset.notes}` : ''}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
          Not sure which to pick? Choose OpenAI Official for official endpoint, or pick by relay
          name.
        </span>
      </label>

      <label className="flex flex-col gap-2">
        <span
          className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          API key
        </span>
        <div className="relative">
          <input
            ref={inputRef}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…  /  sk-…  /  sk-or-…"
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)' }}
            className="w-full h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          />
        </div>
      </label>

      <StatusLine provider={provider} state={state} helpUrl={helpUrl} />

      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="text-[var(--text-sm)] text-[var(--color-text-secondary)]"
      >
        <summary
          className="cursor-pointer select-none text-[var(--text-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          Advanced — custom base URL (proxy / relay)
        </summary>
        <label className="flex flex-col gap-2 mt-3">
          <span
            className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Base URL
          </span>
          <div className="flex gap-2 items-center">
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setConnState({ kind: 'idle' });
              }}
              placeholder={
                selectedPreset && selectedPreset.id !== 'custom'
                  ? selectedPreset.baseUrl
                  : 'https://your-proxy.example.com/v1'
              }
              spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)' }}
              className="flex-1 h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
            />
            <button
              type="button"
              onClick={handleConnectionTest}
              disabled={
                connState.kind === 'testing' ||
                provider === null ||
                trimmed.length === 0 ||
                trimmedBaseUrl.length === 0
              }
              className="h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {connState.kind === 'testing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : connState.kind === 'ok' ? (
                <Wifi className="w-3.5 h-3.5 text-[var(--color-success)]" />
              ) : connState.kind === 'error' ? (
                <WifiOff className="w-3.5 h-3.5 text-[var(--color-error)]" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              {connState.kind === 'testing' ? 'Testing...' : 'Test'}
            </button>
          </div>
          {connState.kind === 'ok' && (
            <span className="text-[var(--text-xs)] text-[var(--color-success)] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Connected
            </span>
          )}
          {connState.kind === 'error' && (
            <span className="text-[var(--text-xs)] text-[var(--color-error)] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {connState.hint}
            </span>
          )}
          <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
            Override the default endpoint for your provider. Useful for relay services (e.g.
            third-party AI gateways) and self-hosted proxies. Leave empty for the official endpoint.
          </span>
        </label>
      </details>

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
    return <Pending text="Detecting provider..." />;
  }
  if (state.kind === 'validating') {
    return (
      <Pending
        text={`Recognized: ${provider ? PROVIDER_SHORTLIST[provider].label : 'unknown'} — validating...`}
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
  const errorMessage = getValidationErrorMessage(state.code, state.message);
  return (
    <div className="text-sm text-[var(--color-error)] flex flex-col gap-1">
      <span className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{errorMessage}</span>
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

function getValidationErrorMessage(
  code: ValidateKeyError['code'] | 'unsupported',
  originalMessage: string,
): string {
  switch (code) {
    case '401':
    case '402':
      return 'API key invalid or unauthorized. Check it in your provider dashboard.';
    case '429':
      return 'Rate limited. Wait a moment and try again.';
    case 'network':
      return 'Cannot reach base URL. Check domain/port/network.';
    default:
      return originalMessage;
  }
}

function Pending({ text }: { text: string }) {
  return (
    <div className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{text}</span>
    </div>
  );
}
