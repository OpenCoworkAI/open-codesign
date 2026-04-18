import { useT } from '@open-codesign/i18n';
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
import type { ConnectionTestError } from '../../../preload/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DetectState =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'detected'; provider: SupportedOnboardingProvider }
  | { kind: 'unknown_prefix' }
  | { kind: 'ipc_error'; message: string }
  | { kind: 'network_error'; message: string };

// Result returned by the detectProvider IPC wrapper. Distinguishing the
// failure modes is required by the no-silent-fallback constraint: an IPC
// crash or network outage must not be reported to the user as a
// "key prefix unrecognized" message.
export type DetectResult =
  | { ok: true; provider: SupportedOnboardingProvider }
  | { ok: false; kind: 'unknown_prefix' }
  | { ok: false; kind: 'ipc_error'; message: string }
  | { ok: false; kind: 'network_error'; message: string };

// Heuristic: detect-provider IPC is purely local (prefix match, no
// network), so any caught error is almost always an IPC failure. We still
// inspect the message in case Electron or a future remote backend surfaces
// a fetch-style error — those should be reported as a network failure.
export function classifyDetectError(err: unknown): 'ipc_error' | 'network_error' {
  if (err instanceof TypeError) return 'network_error';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return 'network_error';
  return 'ipc_error';
}

function detectErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return 'Provider detection failed.';
}

// Single authoritative connection state — no separate ValidationState.
type ConnectionCheck =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok' }
  | { status: 'failed'; code: ConnectionTestError['code']; hint: string };

interface PasteKeyProps {
  onValidated: (
    provider: SupportedOnboardingProvider,
    apiKey: string,
    baseUrl: string | null,
  ) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Default base URLs — must mirror buildDefaultBaseUrl in connection-ipc.ts
// ---------------------------------------------------------------------------

function defaultBaseUrl(provider: SupportedOnboardingProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
  }
}

// ---------------------------------------------------------------------------
// Error hint for connection failures
// ---------------------------------------------------------------------------

function connectionHint(code: ConnectionTestError['code'], t: (key: string) => string): string {
  switch (code) {
    case '401':
      return t('onboarding.paste.connectionTest.errors.401');
    case '404':
      return t('onboarding.paste.connectionTest.errors.404');
    case 'ECONNREFUSED':
      return t('onboarding.paste.connectionTest.errors.ECONNREFUSED');
    case 'NETWORK':
      return t('onboarding.paste.connectionTest.errors.NETWORK');
    case 'PARSE':
      return t('onboarding.paste.connectionTest.errors.PARSE');
    case 'IPC_BAD_INPUT':
      return t('onboarding.paste.connectionTest.errors.IPC_BAD_INPUT');
  }
}

// ---------------------------------------------------------------------------
// Provider detection helper (extracted to keep useEffect complexity low)
// ---------------------------------------------------------------------------

export async function detectProvider(
  trimmed: string,
  bridge: { detectProvider: (key: string) => Promise<string | null> } | undefined,
): Promise<DetectResult> {
  if (!bridge) {
    return {
      ok: false,
      kind: 'ipc_error',
      message: 'Renderer is not connected to the main process.',
    };
  }
  let detected: string | null;
  try {
    detected = await bridge.detectProvider(trimmed);
  } catch (err) {
    return { ok: false, kind: classifyDetectError(err), message: detectErrorMessage(err) };
  }
  if (detected !== null && isSupportedOnboardingProvider(detected)) {
    return { ok: true, provider: detected };
  }
  return { ok: false, kind: 'unknown_prefix' };
}

function applyDetectResult(
  result: DetectResult,
  reqId: number,
  reqIdRef: { current: number },
  setDetectState: (s: DetectState) => void,
  setConnCheck: (s: ConnectionCheck) => void,
): void {
  if (reqId !== reqIdRef.current) return;
  if (result.ok) {
    setDetectState({ kind: 'detected', provider: result.provider });
    setConnCheck({ status: 'idle' });
    return;
  }
  if (result.kind === 'unknown_prefix') {
    setDetectState({ kind: 'unknown_prefix' });
    setConnCheck({ status: 'idle' });
    return;
  }
  // IPC / network failures must surface — never silently downgrade to unknown_prefix.
  setDetectState({ kind: result.kind, message: result.message });
  setConnCheck({
    status: 'failed',
    code: result.kind === 'network_error' ? 'NETWORK' : 'IPC_BAD_INPUT',
    hint: result.message,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PasteKey({ onValidated, onBack }: PasteKeyProps) {
  const t = useT();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<ProxyPresetId | ''>('');
  const [detectState, setDetectState] = useState<DetectState>({ kind: 'idle' });
  const [connCheck, setConnCheck] = useState<ConnectionCheck>({ status: 'idle' });
  const detectReqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = apiKey.trim();
  const trimmedBaseUrl = baseUrl.trim();

  // Derived: the provider from detect state (if known)
  const detectedProvider = detectState.kind === 'detected' ? detectState.provider : null;

  // Detect provider on key change (lightweight prefix-match IPC, no network auth)
  useEffect(() => {
    if (trimmed.length === 0) {
      setDetectState({ kind: 'idle' });
      setConnCheck({ status: 'idle' });
      return;
    }
    setDetectState({ kind: 'detecting' });
    const reqId = ++detectReqRef.current;
    const handle = window.setTimeout(() => {
      void detectProvider(trimmed, window.codesign).then((result) =>
        applyDetectResult(result, reqId, detectReqRef, setDetectState, setConnCheck),
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [trimmed]);

  function handleBaseUrlChange(value: string) {
    setBaseUrl(value);
    setConnCheck({ status: 'idle' });
  }

  function handlePresetChange(presetId: string) {
    if (presetId === '') {
      setSelectedPresetId('');
      setBaseUrl('');
      setConnCheck({ status: 'idle' });
      return;
    }
    const preset = PROXY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedPresetId(preset.id as ProxyPresetId);
    setBaseUrl(preset.baseUrl);
    if (preset.id !== 'custom') setAdvancedOpen(true);
    setConnCheck({ status: 'idle' });
  }

  // The effective base URL passed to connection.test:
  // – if user typed something, use that
  // – otherwise fall back to the provider's official default (same as main-process default)
  function effectiveBaseUrl(): string {
    if (trimmedBaseUrl.length > 0) return trimmedBaseUrl;
    if (detectedProvider !== null) return defaultBaseUrl(detectedProvider);
    return '';
  }

  async function handleTest() {
    if (!detectedProvider || trimmed.length === 0) return;
    const baseUrlForTest = effectiveBaseUrl();
    if (baseUrlForTest.length === 0) return;

    if (!window.codesign?.connection) {
      setConnCheck({
        status: 'failed',
        code: 'NETWORK',
        hint: t('onboarding.paste.errors.rendererDisconnected'),
      });
      return;
    }

    setConnCheck({ status: 'testing' });
    try {
      const result = await window.codesign.connection.test({
        provider: detectedProvider,
        apiKey: trimmed,
        baseUrl: baseUrlForTest,
      });
      if (result.ok) {
        setConnCheck({ status: 'ok' });
      } else {
        const err = result as ConnectionTestError;
        setConnCheck({ status: 'failed', code: err.code, hint: connectionHint(err.code, t) });
      }
    } catch (err) {
      setConnCheck({
        status: 'failed',
        code: 'NETWORK',
        hint:
          err instanceof Error ? err.message : t('onboarding.paste.connectionTest.errors.NETWORK'),
      });
    }
  }

  const helpUrl = useMemo(() => {
    if (detectedProvider === null) return null;
    return PROVIDER_SHORTLIST[detectedProvider].keyHelpUrl;
  }, [detectedProvider]);

  function handleContinue() {
    if (connCheck.status !== 'ok' || detectedProvider === null) return;
    onValidated(detectedProvider, trimmed, trimmedBaseUrl.length > 0 ? trimmedBaseUrl : null);
  }

  const selectedPreset = PROXY_PRESETS.find((p) => p.id === selectedPresetId);
  const testDisabled =
    connCheck.status === 'testing' || detectedProvider === null || trimmed.length === 0;
  const continueDisabled = connCheck.status !== 'ok';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-text-primary)] tracking-[var(--tracking-heading)] leading-[var(--leading-heading)]">
          {t('onboarding.paste.title')}
        </h2>
        <p className="text-[var(--text-base)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          {t('onboarding.paste.description')}
        </p>
      </div>

      {/* Preset selector */}
      <label className="flex flex-col gap-2">
        <span
          className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {t('onboarding.paste.preset.label')}
        </span>
        <select
          value={selectedPresetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)] appearance-none cursor-pointer"
        >
          <option value="">{t('onboarding.paste.preset.placeholder')}</option>
          {PROXY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
              {preset.notes ? ` — ${preset.notes}` : ''}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
          {t('onboarding.paste.preset.hint')}
        </span>
      </label>

      {/* API key input */}
      <label className="flex flex-col gap-2">
        <span
          className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {t('onboarding.paste.apiKey.label')}
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

      <DetectLine state={detectState} helpUrl={helpUrl} t={t} />

      {/* Advanced: custom base URL */}
      <details
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="text-[var(--text-sm)] text-[var(--color-text-secondary)]"
      >
        <summary
          className="cursor-pointer select-none text-[var(--text-xs)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {t('onboarding.paste.advanced.toggle')}
        </summary>
        <label className="flex flex-col gap-2 mt-3">
          <span
            className="text-[var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)] font-medium"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {t('onboarding.paste.baseUrl.label')}
          </span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => handleBaseUrlChange(e.target.value)}
            placeholder={
              selectedPreset && selectedPreset.id !== 'custom'
                ? selectedPreset.baseUrl
                : 'https://your-proxy.example.com/v1'
            }
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono)' }}
            className="w-full h-[var(--size-control-md)] px-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-focus-ring)] transition-[box-shadow,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          />
          <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
            {t('onboarding.paste.advanced.description')}
          </span>
        </label>
      </details>

      {/* Test button + connection status — the sole authority for key+endpoint verification */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testDisabled}
          className="self-start h-[var(--size-control-md)] px-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {connCheck.status === 'testing' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : connCheck.status === 'ok' ? (
            <Wifi className="w-4 h-4 text-[var(--color-success)]" />
          ) : connCheck.status === 'failed' ? (
            <WifiOff className="w-4 h-4 text-[var(--color-error)]" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          {connCheck.status === 'testing'
            ? t('onboarding.paste.connectionTest.testing')
            : t('onboarding.paste.connectionTest.button')}
        </button>

        {connCheck.status === 'ok' && (
          <span className="text-[var(--text-sm)] text-[var(--color-success)] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {t('onboarding.paste.connectionTest.okVerified')}
          </span>
        )}
        {connCheck.status === 'failed' && (
          <span className="text-[var(--text-sm)] text-[var(--color-error)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {connCheck.hint}
          </span>
        )}
        {connCheck.status === 'idle' && detectedProvider !== null && (
          <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
            {t('onboarding.paste.connectionTest.idleHint')}
          </span>
        )}
      </div>

      <div className="flex justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          {t('onboarding.paste.back')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleContinue}
          disabled={continueDisabled}
          title={continueDisabled ? t('onboarding.paste.connectionTest.runFirst') : undefined}
        >
          {t('onboarding.paste.continue')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DetectLineProps {
  state: DetectState;
  helpUrl: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function DetectLine({ state, helpUrl, t }: DetectLineProps) {
  if (state.kind === 'idle') {
    return (
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
        {t('onboarding.paste.statusIdle')}
      </p>
    );
  }
  if (state.kind === 'detecting') {
    return (
      <div className="text-[var(--text-sm)] text-[var(--color-text-secondary)] flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>{t('onboarding.paste.statusDetecting')}</span>
      </div>
    );
  }
  if (state.kind === 'detected') {
    return (
      <div className="text-[var(--text-sm)] text-[var(--color-text-secondary)] flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0" />
        <span>
          {t('onboarding.paste.statusDetected', {
            provider: PROVIDER_SHORTLIST[state.provider].label,
          })}
        </span>
        {helpUrl !== null ? (
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--text-xs)] text-[var(--color-accent)] hover:underline ml-1"
          >
            {t('onboarding.paste.getKey')} <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </div>
    );
  }
  if (state.kind === 'unknown_prefix') {
    return (
      <div className="text-[var(--text-sm)] text-[var(--color-error)] flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{t('onboarding.paste.errors.unsupported')}</span>
      </div>
    );
  }
  if (state.kind === 'ipc_error') {
    return (
      <div className="text-[var(--text-sm)] text-[var(--color-error)] flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>
          {t('onboarding.paste.errors.detectIpc', { message: state.message })}
        </span>
      </div>
    );
  }
  return (
    <div className="text-[var(--text-sm)] text-[var(--color-error)] flex items-center gap-2">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>
        {t('onboarding.paste.errors.detectNetwork', { message: state.message })}
      </span>
    </div>
  );
}
