import { useT } from '@open-codesign/i18n';
import {
  SaveWebSearchSettingsInput,
  WebSearchSettingsState,
  WebSearchTestResult,
} from '@open-codesign/shared';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Row, SectionTitle } from './primitives';

export const WEB_SEARCH_TEST_MESSAGES = {
  ok: 'settings.webSearch.result.ok',
  'missing-key': 'settings.webSearch.result.missingKey',
  'unreadable-key': 'settings.webSearch.result.unreadableKey',
  'invalid-key': 'settings.webSearch.result.invalidKey',
  quota: 'settings.webSearch.result.quota',
  'rate-limit': 'settings.webSearch.result.rateLimit',
  timeout: 'settings.webSearch.result.timeout',
  'network-error': 'settings.webSearch.result.networkError',
  'service-error': 'settings.webSearch.result.serviceError',
  'unexpected-response': 'settings.webSearch.result.unexpectedResponse',
} as const satisfies Record<WebSearchTestResult['status'], string>;

type Notice = { key: string; error?: boolean; httpStatus?: number };

export function WebSearchTab() {
  const t = useT();
  const [settings, setSettings] = useState<WebSearchSettingsState | null>(null);
  // Never hydrate credentials from saved settings or retain them outside this mounted form.
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function loadSettings() {
    setNotice(null);
    try {
      const bridge = window.codesign?.webSearch;
      if (!bridge) throw new Error('Unavailable');
      const next = WebSearchSettingsState.parse(await bridge.get());
      if (mounted.current) setSettings(next);
    } catch {
      if (mounted.current) setNotice({ key: 'settings.webSearch.loadFailed', error: true });
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load only on mount, never test automatically
  useEffect(() => {
    mounted.current = true;
    void loadSettings();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save(input: SaveWebSearchSettingsInput) {
    if (busyRef.current || !settings) return;
    setApiKey('');
    const parsed = SaveWebSearchSettingsInput.safeParse(input);
    if (!parsed.success) {
      setNotice({ key: 'settings.webSearch.invalidInput', error: true });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setConfirmClear(false);
    try {
      const bridge = window.codesign?.webSearch;
      if (!bridge) throw new Error('Unavailable');
      const next = WebSearchSettingsState.parse(await bridge.save(parsed.data));
      if (!mounted.current) return;
      setSettings(next);
      setNotice({
        key: input.clearKey ? 'settings.webSearch.cleared' : 'settings.webSearch.saved',
      });
    } catch {
      if (mounted.current) setNotice({ key: 'settings.webSearch.saveFailed', error: true });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function testSavedKey() {
    if (busyRef.current || !settings?.hasKey) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setConfirmClear(false);
    try {
      const bridge = window.codesign?.webSearch;
      if (!bridge) throw new Error('Unavailable');
      const result = WebSearchTestResult.parse(await bridge.test());
      if (mounted.current) {
        setNotice({
          key: WEB_SEARCH_TEST_MESSAGES[result.status],
          error: result.status !== 'ok',
          ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        });
      }
    } catch {
      if (mounted.current) setNotice({ key: 'settings.webSearch.testFailed', error: true });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function openKeyPage() {
    try {
      const bridge = window.codesign;
      if (!bridge) throw new Error('Unavailable');
      await bridge.openExternal('https://app.tavily.com');
    } catch {
      if (mounted.current) setNotice({ key: 'settings.webSearch.openFailed', error: true });
    }
  }

  const buttonClass =
    'inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-[var(--text-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed';
  const hintClass =
    'text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-body)]';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionTitle>{t('settings.webSearch.title')}</SectionTitle>
        <p className={hintClass}>{t('settings.webSearch.description')}</p>
        <p className={hintClass}>{t('settings.webSearch.nextRun')}</p>
      </div>

      <Row label={t('settings.webSearch.enabled')} hint={t('settings.webSearch.enabledHint')}>
        <input
          type="checkbox"
          role="switch"
          aria-label={t('settings.webSearch.enabled')}
          checked={settings?.enabled ?? false}
          disabled={!settings || busy}
          onChange={(event) => void save({ enabled: event.target.checked })}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </Row>

      <Row label={t('settings.webSearch.keyStatus')}>
        <span className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
          {t(
            !settings
              ? 'settings.common.loading'
              : settings.hasKey
                ? 'settings.webSearch.configured'
                : 'settings.webSearch.notConfigured',
          )}
        </span>
      </Row>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void save({ apiKey: String(data.get('apiKey') ?? '') });
        }}
      >
        <label
          htmlFor="tavily-api-key"
          className="block text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)]"
        >
          {t(settings?.hasKey ? 'settings.webSearch.replaceKey' : 'settings.webSearch.newKey')}
        </label>
        <input
          id="tavily-api-key"
          name="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          disabled={!settings || busy}
          aria-describedby="tavily-key-hint"
          placeholder={t('settings.webSearch.keyPlaceholder')}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
        />
        <p id="tavily-key-hint" className={hintClass}>
          {t('settings.webSearch.keyHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={!settings || busy || !apiKey.trim()}
            className={buttonClass}
          >
            {t(
              settings?.hasKey
                ? 'settings.webSearch.saveReplacement'
                : 'settings.webSearch.saveKey',
            )}
          </button>
          <button type="button" onClick={() => void openKeyPage()} className={buttonClass}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t('settings.webSearch.getKey')}
          </button>
          <button
            type="button"
            disabled={!settings?.hasKey || busy}
            onClick={() => setConfirmClear(true)}
            className={buttonClass}
          >
            {t('settings.webSearch.clearKey')}
          </button>
        </div>
      </form>

      {confirmClear ? (
        <div className="space-y-2">
          <p className={hintClass}>{t('settings.webSearch.clearConfirm')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ clearKey: true })}
              className={buttonClass}
            >
              {t('settings.webSearch.confirmClear')}
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className={buttonClass}>
              {t('settings.common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-4">
        <button
          type="button"
          disabled={!settings?.hasKey || busy}
          onClick={() => void testSavedKey()}
          className={buttonClass}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('settings.webSearch.test')}
        </button>
        <p className={hintClass}>{t('settings.webSearch.testHint')}</p>
      </div>
      {notice ? (
        <div className="space-y-2">
          <p
            role={notice.error ? 'alert' : 'status'}
            className="text-[var(--text-sm)] text-[var(--color-text-secondary)]"
          >
            {t(notice.key)}
            {notice.httpStatus !== undefined ? ` (HTTP ${notice.httpStatus})` : null}
          </p>
          {!settings ? (
            <button type="button" onClick={() => void loadSettings()} className={buttonClass}>
              {t('settings.webSearch.retry')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
