import { useT } from '@open-codesign/i18n';
import type { WireApi } from '@open-codesign/shared';
import {
  isSupportedOnboardingProvider,
  PROVIDER_SHORTLIST as SHORTLIST,
} from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { Check, Loader2, Plus, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ProviderRow } from '../../../../preload/index';
import { recordAction } from '../../lib/action-timeline';
import { useCodesignStore } from '../../store';
import { AddCustomProviderModal } from '../AddCustomProviderModal';
import { ChatgptLoginCard } from '../ChatgptLoginCard';
import {
  cleanIpcError,
  ImportBanner,
  ParseErrorBanner,
  ProviderCard,
  SectionTitle,
  WarningsList,
} from './primitives';

/**
 * Keep in sync with `PARSE_REASON_NOT_JSON_OBJECT` in
 * apps/desktop/src/main/imports/claude-code-config.ts. The renderer can't
 * import main-process modules, so the sentinel is duplicated.
 */
const PARSE_REASON_NOT_JSON_OBJECT = '__parse_reason_not_json_object__';

const DISMISSED_BANNER_PREFIX = 'open-codesign:settings:dismissed-import-banner:';

const CPA_DETECTION_DISMISSED_KEY = 'cpa-detection-dismissed-v1';

/**
 * Strip any user:pass@ credentials from a URL before putting it into visible
 * copy. Falls back to the raw string on parse failure.
 */
function maskBaseUrlCreds(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username === '' && u.password === '') return raw;
    u.username = '';
    u.password = '';
    // Preserve the input's trailing-slash shape; URL.toString() always appends one.
    return u.toString().replace(/\/$/, raw.endsWith('/') ? '/' : '');
  } catch {
    return raw;
  }
}

function readDismissed(kind: 'codex' | 'claudeCode' | 'gemini' | 'opencode'): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_BANNER_PREFIX + kind) === '1';
  } catch {
    return false;
  }
}
function writeDismissed(kind: 'codex' | 'claudeCode' | 'gemini' | 'opencode'): void {
  try {
    window.localStorage.setItem(DISMISSED_BANNER_PREFIX + kind, '1');
  } catch {
    // localStorage may be unavailable in tests; non-fatal
  }
}

/**
 * Full-width multi-line banner for the OAuth-subscription case — users who
 * logged into Claude Code via Pro/Max OAuth and cannot share that quota with
 * third-party apps.
 */
function OAuthSubscriptionBanner({
  onDismiss,
  onIHaveKey,
}: {
  onDismiss: () => void;
  onIHaveKey: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-3 space-y-2">
      <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
        {t('settings.providers.import.claudeCodeOAuthTitle')}
      </div>
      <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-relaxed">
        {t('settings.providers.import.claudeCodeOAuthBody')}
      </p>
      <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-relaxed">
        {t('settings.providers.import.claudeCodeShellEnvHint')}
      </p>
      {/* DOM order: primary → secondary → dismiss so keyboard Tab lands on
          real actions first. Flex layout pushes Dismiss right on wide, wraps
          on narrow. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="h-7 px-2.5 inline-flex items-center rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {t('settings.providers.import.claudeCodeOAuthCtaConsole')}
          </a>
          <button
            type="button"
            onClick={onIHaveKey}
            className="h-7 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
          >
            {t('settings.providers.import.claudeCodeIHaveKey')}
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 px-2 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
        >
          {t('settings.providers.import.dismiss')}
        </button>
      </div>
    </div>
  );
}

function LocalCpaImportCard({
  onImport,
  onDismiss,
}: {
  onImport: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent-tint)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-start gap-[var(--space-3)]">
      <Zap className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] leading-snug">
          {t('settings.providers.cpaDetection.title')}
        </p>
        <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] mt-0.5 leading-[var(--leading-body)]">
          {t('settings.providers.cpaDetection.body')}
        </p>
      </div>
      <div className="flex items-center gap-[var(--space-1_5)] shrink-0">
        <button
          type="button"
          onClick={onImport}
          className="h-7 px-[var(--space-2_5)] rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-on-accent)] bg-[var(--color-accent)] hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          {t('settings.providers.cpaDetection.importAction')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="h-7 px-[var(--space-2)] rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors whitespace-nowrap"
        >
          {t('settings.providers.cpaDetection.dismissAction')}
        </button>
      </div>
    </div>
  );
}

interface AddProviderMenuProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  hasClaudeCodeImported: boolean;
  hasOllamaImported: boolean;
  onImportCodex: () => void;
  onImportClaudeCode: () => void;
  onAddOllama: () => void;
  onAddCustom: () => void;
  onAddCliProxyApi: () => void;
}

function AddProviderMenu({
  open,
  setOpen,
  hasClaudeCodeImported,
  hasOllamaImported,
  onImportCodex,
  onImportClaudeCode,
  onAddOllama,
  onAddCustom,
  onAddCliProxyApi,
}: AddProviderMenuProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const items: Array<{
    key: string;
    label: string;
    desc: string;
    disabled: boolean;
    onClick: () => void;
  }> = [
    {
      key: 'codex',
      label: t('settings.providers.import.codexMenu', { defaultValue: '从 Codex 导入' }),
      desc: t('settings.providers.import.codexMenuDesc', {
        defaultValue: '读取 ~/.codex/config.toml',
      }),
      disabled: false,
      onClick: onImportCodex,
    },
    {
      key: 'claudeCode',
      label: t('settings.providers.import.claudeCodeMenu', {
        defaultValue: '从 Claude Code 导入',
      }),
      desc: t('settings.providers.import.claudeCodeMenuDesc', {
        defaultValue: '读取已登录的 Claude Code 会话',
      }),
      disabled: hasClaudeCodeImported,
      onClick: onImportClaudeCode,
    },
    {
      key: 'ollama',
      label: t('settings.providers.import.ollamaMenu'),
      desc: t('settings.providers.import.ollamaMenuDesc'),
      disabled: hasOllamaImported,
      onClick: onAddOllama,
    },
    {
      key: 'custom',
      label: t('settings.providers.import.customMenu', { defaultValue: '自定义服务' }),
      desc: t('settings.providers.import.customMenuDesc', {
        defaultValue: '手动填写 API key 和 URL',
      }),
      disabled: false,
      onClick: onAddCustom,
    },
    {
      key: 'cli-proxy-api',
      label: t('settings.providers.cliProxyApi.presetName', { defaultValue: 'CLIProxyAPI' }),
      desc: t('settings.providers.cliProxyApi.presetDescription', {
        defaultValue: 'Local proxy that wraps Claude/Codex/Gemini OAuth subscriptions',
      }),
      disabled: false,
      onClick: onAddCliProxyApi,
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
        <Plus className="w-3.5 h-3.5" />
        {t('settings.providers.addProvider')}
      </Button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-[6px] z-50 w-[260px] rounded-[10px] border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] shadow-[0_8px_28px_rgba(0,0,0,0.1)] overflow-hidden"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onClick}
              className="w-full text-left px-[14px] py-[10px] flex flex-col gap-[2px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--color-surface-hover)]"
            >
              <span className="flex items-center gap-[6px] text-[13px] font-medium text-[var(--color-text-primary)]">
                {item.label}
                {item.disabled ? (
                  <Check className="w-[12px] h-[12px] text-[var(--color-accent)]" />
                ) : null}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)] leading-[1.4]">
                {item.disabled
                  ? t('settings.providers.import.alreadyImported', {
                      defaultValue: '已导入',
                    })
                  : item.desc}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ModelsTab() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const setConfig = useCodesignStore((s) => s.completeOnboarding);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const reportableErrorToast = useCodesignStore((s) => s.reportableErrorToast);
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [cpaDetection, setCpaDetection] = useState<
    'idle' | 'detecting' | 'available' | 'unavailable'
  >('idle');
  const [externalConfigs, setExternalConfigs] = useState<{
    codex?: { count: number } | undefined;
    claudeCode?:
      | {
          userType: 'has-api-key' | 'oauth-only' | 'local-proxy' | 'remote-gateway' | 'parse-error';
          baseUrl: string;
          defaultModel: string;
          apiKeySource: 'settings-json' | 'shell-env' | 'none';
          hasApiKey: boolean;
          settingsPath: string;
          warnings: string[];
        }
      | undefined;
    gemini?:
      | {
          hasApiKey: boolean;
          apiKeySource: 'gemini-env' | 'home-env' | 'shell-env' | 'none';
          keyPath: string | null;
          warnings: string[];
          blocked: boolean;
        }
      | undefined;
    opencode?:
      | { count: number; providerLabels: string[]; warnings: string[]; blocked: boolean }
      | undefined;
  } | null>(null);
  /**
   * When set, `AddCustomProviderModal` mounts with these fields pre-filled.
   * Used by the OAuth "I have an API key" path and the local-proxy / remote-
   * gateway paths to pre-fill the detected endpoint.
   */
  const [customProviderPreset, setCustomProviderPreset] = useState<
    | {
        name: string;
        baseUrl: string;
        wire: WireApi;
        defaultModel?: string;
      }
    | undefined
  >(undefined);
  /** Edit-mode target. Works for both builtin and custom providers; builtins
   *  get their endpoint fields locked. */
  const [editingRow, setEditingRow] = useState<ProviderRow | null>(null);

  function handleEdit(row: ProviderRow) {
    setEditingRow(row);
  }

  useEffect(() => {
    if (!window.codesign) return;
    void window.codesign.settings
      .listProviders()
      .then(setRows)
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.providers.toast.loadFailed'),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
      })
      .finally(() => setLoading(false));
    void window.codesign.config
      .detectExternalConfigs()
      .then((detected) => {
        const dismissedCodex = readDismissed('codex');
        const dismissedClaudeCode = readDismissed('claudeCode');
        const dismissedGemini = readDismissed('gemini');
        const dismissedOpencode = readDismissed('opencode');
        const surface =
          detected.claudeCode !== undefined &&
          detected.claudeCode.userType !== 'no-config' &&
          !dismissedClaudeCode;
        setExternalConfigs({
          ...(detected.codex !== undefined && !dismissedCodex
            ? { codex: { count: detected.codex.providers.length } }
            : {}),
          ...(surface && detected.claudeCode !== undefined
            ? {
                claudeCode: {
                  userType: detected.claudeCode.userType as
                    | 'has-api-key'
                    | 'oauth-only'
                    | 'local-proxy'
                    | 'remote-gateway'
                    | 'parse-error',
                  baseUrl: detected.claudeCode.baseUrl,
                  defaultModel: detected.claudeCode.defaultModel,
                  apiKeySource: detected.claudeCode.apiKeySource,
                  hasApiKey: detected.claudeCode.hasApiKey,
                  settingsPath: detected.claudeCode.settingsPath,
                  warnings: detected.claudeCode.warnings ?? [],
                },
              }
            : {}),
          ...(detected.gemini !== undefined && !dismissedGemini
            ? {
                gemini: {
                  hasApiKey: detected.gemini.hasApiKey,
                  apiKeySource: detected.gemini.apiKeySource,
                  keyPath: detected.gemini.keyPath,
                  warnings: detected.gemini.warnings ?? [],
                  blocked: detected.gemini.blocked,
                },
              }
            : {}),
          ...(detected.opencode !== undefined && !dismissedOpencode
            ? {
                opencode: {
                  count: detected.opencode.providers.length,
                  providerLabels: detected.opencode.providers.map((p) => p.name),
                  warnings: detected.opencode.warnings ?? [],
                  blocked: detected.opencode.blocked,
                },
              }
            : {}),
        });
      })
      .catch(() => {
        // non-fatal; banner just doesn't appear
      });
  }, [pushToast, t]);

  useEffect(() => {
    if (!window.codesign?.config?.testEndpoint) return;
    if (cpaDetection !== 'idle') return;
    try {
      if (window.localStorage.getItem(CPA_DETECTION_DISMISSED_KEY) === '1') return;
    } catch {
      // localStorage unavailable — proceed with detection
    }
    // Wait for rows load so we don't flash the banner and immediately hide it.
    if (loading) return;
    const alreadyConfigured = rows.some((r) =>
      /^https?:\/\/(localhost|127\.0\.0\.1):8317/.test(r.baseUrl ?? ''),
    );
    if (alreadyConfigured) return;

    setCpaDetection('detecting');
    void window.codesign.config
      .testEndpoint({
        wire: 'anthropic',
        baseUrl: 'http://127.0.0.1:8317',
        apiKey: '',
        allowPrivateNetwork: true,
      })
      .then((res) => {
        setCpaDetection(res.ok ? 'available' : 'unavailable');
      })
      .catch((err) => {
        reportableErrorToast({
          code: 'CPA_DETECTION_FAILED',
          scope: 'settings',
          title: t('settings.imageGen.toast.loadFailed', {
            defaultValue: 'Image generation settings failed to load',
          }),
          description: cleanIpcError(err) || t('settings.common.unknownError'),
        });
        setCpaDetection('unavailable');
      });
  }, [cpaDetection, loading, rows, reportableErrorToast, t]);

  async function reloadRows() {
    if (!window.codesign) return;
    const [nextRows, state] = await Promise.all([
      window.codesign.settings.listProviders(),
      window.codesign.onboarding.getState(),
    ]);
    setRows(nextRows);
    setConfig(state);
  }

  async function handleImportCodex() {
    if (!window.codesign) return;
    try {
      await window.codesign.config.importCodexConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, codex: undefined }));
      await reloadRows();
      pushToast({ variant: 'success', title: t('settings.providers.import.codexDone') });
    } catch (err) {
      reportableErrorToast({
        code: 'CODEX_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleAddOllama() {
    if (!window.codesign) return;
    try {
      await window.codesign.settings.addProvider({
        provider: 'ollama',
        apiKey: '',
        modelPrimary: SHORTLIST.ollama.defaultPrimary,
      });
      await reloadRows();
      pushToast({ variant: 'success', title: t('settings.providers.import.ollamaDone') });
    } catch (err) {
      reportableErrorToast({
        code: 'OLLAMA_ADD_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.saveFailed'),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportGemini() {
    if (!window.codesign) return;
    // Pre-import warnings (e.g. "AIzaSy pattern mismatch") surface in the toast
    // so soft-validation failure doesn't silently ship an invalid key.
    const geminiWarnings = externalConfigs?.gemini?.warnings ?? [];
    try {
      await window.codesign.config.importGeminiConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, gemini: undefined }));
      await reloadRows();
      const description =
        geminiWarnings.length > 0 ? geminiWarnings.slice(0, 2).join('\n') : undefined;
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.geminiDone'),
        ...(description !== undefined ? { description } : {}),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'GEMINI_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportOpencode() {
    if (!window.codesign) return;
    // Skipped-entry summary: OpenCode often has OAuth entries we skip; users
    // need to see the reasons so "imported 3 providers" doesn't hide the rest.
    const skippedSummary = externalConfigs?.opencode?.warnings ?? [];
    try {
      await window.codesign.config.importOpencodeConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, opencode: undefined }));
      await reloadRows();
      const description =
        skippedSummary.length > 0
          ? skippedSummary.slice(0, 3).join('\n') +
            (skippedSummary.length > 3 ? `\n+${skippedSummary.length - 3} more` : '')
          : undefined;
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.opencodeDone'),
        ...(description !== undefined ? { description } : {}),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'OPENCODE_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleImportClaudeCode() {
    if (!window.codesign) return;
    // Only `has-api-key` reaches here; other userTypes open the paste modal.
    try {
      await window.codesign.config.importClaudeCodeConfig();
      setExternalConfigs((prev) => (prev === null ? null : { ...prev, claudeCode: undefined }));
      await reloadRows();
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.claudeCodeImportedActivated'),
      });
    } catch (err) {
      // Safety net for stale detection → OAuth-only race.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'CLAUDE_CODE_OAUTH_ONLY') {
        pushToast({
          variant: 'info',
          title: t('settings.providers.import.oauthErrorToast'),
          action: {
            label: t('settings.providers.import.oauthErrorToastCta'),
            onClick: () => {
              window.open('https://console.anthropic.com/settings/keys', '_blank');
            },
          },
        });
        return;
      }
      reportableErrorToast({
        code: 'CLAUDECODE_IMPORT_FAILED',
        scope: 'onboarding',
        title: t('settings.providers.import.failed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        reportable: false,
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleCopyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      pushToast({
        variant: 'success',
        title: t('settings.providers.import.claudeCodeParseErrorPathCopied'),
      });
    } catch {
      pushToast({
        variant: 'error',
        title: t('settings.common.unknownError'),
        description: path,
      });
    }
  }

  async function handleDelete(provider: string) {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.settings.deleteProvider(provider);
      setRows(next);
      const newState = await window.codesign.onboarding.getState();
      setConfig(newState);
      pushToast({ variant: 'success', title: t('settings.providers.toast.removed') });
      // If the user deleted the claude-code-imported row, re-run detection so
      // the banner can reappear.
      if (provider === 'claude-code-imported') {
        try {
          const detected = await window.codesign.config.detectExternalConfigs();
          const detectedCc = detected.claudeCode;
          const dismissedClaudeCode = readDismissed('claudeCode');
          if (
            detectedCc !== undefined &&
            detectedCc.userType !== 'no-config' &&
            !dismissedClaudeCode
          ) {
            setExternalConfigs((prev) => ({
              ...(prev ?? {}),
              claudeCode: {
                userType: detectedCc.userType as
                  | 'has-api-key'
                  | 'oauth-only'
                  | 'local-proxy'
                  | 'remote-gateway'
                  | 'parse-error',
                baseUrl: detectedCc.baseUrl,
                defaultModel: detectedCc.defaultModel,
                apiKeySource: detectedCc.apiKeySource,
                hasApiKey: detectedCc.hasApiKey,
                settingsPath: detectedCc.settingsPath,
                warnings: detectedCc.warnings ?? [],
              },
            }));
          }
        } catch {
          /* non-fatal: banner just won't reappear this session */
        }
      }
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_DELETE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.deleteFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  async function handleActivate(provider: string) {
    if (!window.codesign) return;
    const sl = isSupportedOnboardingProvider(provider) ? SHORTLIST[provider] : null;
    const currentRow = rows.find((r) => r.provider === provider);
    const defaultModel =
      currentRow?.defaultModel || sl?.defaultPrimary || config?.modelPrimary || '';
    const label = sl?.label ?? currentRow?.label ?? provider;
    if (defaultModel.length === 0) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.toast.activateFailed'),
        description: t('settings.providers.toast.missingModel'),
      });
      return;
    }
    try {
      const next = await window.codesign.settings.setActiveProvider({
        provider,
        modelPrimary: defaultModel,
      });
      recordAction({
        type: 'provider.switch',
        data: { provider, modelId: defaultModel },
      });
      setConfig(next);
      const updatedRows = await window.codesign.settings.listProviders();
      setRows(updatedRows);
      pushToast({
        variant: 'success',
        title: t('settings.providers.toast.switchedTo', { label }),
      });
    } catch (err) {
      reportableErrorToast({
        code: 'PROVIDER_ACTIVATE_FAILED',
        scope: 'settings',
        title: t('settings.providers.toast.switchFailed'),
        description: cleanIpcError(err) || t('settings.common.unknownError'),
        ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
      });
    }
  }

  return (
    <>
      {showAddCustom && (
        <AddCustomProviderModal
          onSave={async () => {
            // If save came from a Claude Code banner (preset set), clear the
            // banner — the provider it was nagging about is now imported.
            const cameFromClaudeCodeBanner = customProviderPreset !== undefined;
            setShowAddCustom(false);
            setCustomProviderPreset(undefined);
            if (cameFromClaudeCodeBanner) {
              setExternalConfigs((prev) =>
                prev === null ? null : { ...prev, claudeCode: undefined },
              );
            }
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => {
            setShowAddCustom(false);
            setCustomProviderPreset(undefined);
          }}
          {...(customProviderPreset !== undefined ? { initialValues: customProviderPreset } : {})}
        />
      )}

      {editingRow !== null && (
        <AddCustomProviderModal
          onSave={async () => {
            setEditingRow(null);
            await reloadRows();
            pushToast({ variant: 'success', title: t('settings.providers.toast.saved') });
          }}
          onClose={() => setEditingRow(null)}
          editTarget={{
            id: editingRow.provider,
            name: editingRow.name,
            baseUrl: editingRow.baseUrl ?? '',
            wire: editingRow.wire,
            defaultModel: editingRow.defaultModel,
            builtin: editingRow.builtin,
            lockEndpoint: editingRow.builtin,
            ...(editingRow.maskedKey.length > 0 ? { keyMask: editingRow.maskedKey } : {}),
          }}
          initialSetAsActive={false}
        />
      )}

      <div className="space-y-[var(--space-3)]">
        <ChatgptLoginCard onStatusChange={reloadRows} />
        {cpaDetection === 'available' && (
          <LocalCpaImportCard
            onImport={() => {
              setCustomProviderPreset({
                name: 'CLIProxyAPI',
                baseUrl: 'http://127.0.0.1:8317',
                wire: 'anthropic',
                defaultModel: '',
              });
              setShowAddCustom(true);
              setCpaDetection('unavailable');
            }}
            onDismiss={() => {
              try {
                window.localStorage.setItem(CPA_DETECTION_DISMISSED_KEY, '1');
              } catch {
                // non-fatal
              }
              setCpaDetection('unavailable');
            }}
          />
        )}
        {externalConfigs !== null &&
          (externalConfigs.codex !== undefined ||
            externalConfigs.claudeCode !== undefined ||
            externalConfigs.gemini !== undefined ||
            externalConfigs.opencode !== undefined) && (
            <div className="space-y-2">
              {externalConfigs.codex !== undefined && (
                <ImportBanner
                  label={t('settings.providers.import.codexFound', {
                    count: externalConfigs.codex.count,
                  })}
                  onImport={handleImportCodex}
                  onDismiss={() => {
                    writeDismissed('codex');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, codex: undefined },
                    );
                  }}
                />
              )}
              {externalConfigs.opencode !== undefined &&
                (() => {
                  const oc = externalConfigs.opencode;
                  const dismiss = () => {
                    writeDismissed('opencode');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, opencode: undefined },
                    );
                  };
                  if (oc.blocked) {
                    return (
                      <ImportBanner
                        label={oc.warnings[0] ?? t('settings.providers.import.opencodeBlocked')}
                        onDismiss={dismiss}
                      />
                    );
                  }
                  const head = oc.providerLabels.slice(0, 3).join(', ');
                  const overflow = oc.providerLabels.length - 3;
                  const providerSummary = overflow > 0 ? `${head} +${overflow} more` : head;
                  return (
                    <ImportBanner
                      label={t('settings.providers.import.opencodeFound', {
                        count: oc.count,
                        providers: providerSummary,
                      })}
                      onImport={handleImportOpencode}
                      onDismiss={dismiss}
                    />
                  );
                })()}
              {externalConfigs.gemini !== undefined &&
                (() => {
                  const g = externalConfigs.gemini;
                  const dismiss = () => {
                    writeDismissed('gemini');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, gemini: undefined },
                    );
                  };
                  if (g.blocked) {
                    return (
                      <ImportBanner
                        label={g.warnings[0] ?? t('settings.providers.import.geminiBlocked')}
                        onDismiss={dismiss}
                      />
                    );
                  }
                  const label = g.hasApiKey
                    ? t('settings.providers.import.geminiFound')
                    : t('settings.providers.import.geminiNoKey');
                  return (
                    <ImportBanner
                      label={label}
                      {...(g.hasApiKey ? { onImport: handleImportGemini } : {})}
                      onDismiss={dismiss}
                    />
                  );
                })()}
              {externalConfigs.claudeCode !== undefined &&
                (() => {
                  const cc = externalConfigs.claudeCode;
                  const displayBaseUrl = maskBaseUrlCreds(cc.baseUrl);
                  const dismiss = () => {
                    writeDismissed('claudeCode');
                    setExternalConfigs((prev) =>
                      prev === null ? null : { ...prev, claudeCode: undefined },
                    );
                  };
                  const openAnthropicPaste = () => {
                    setCustomProviderPreset({
                      name: t('settings.providers.import.claudeCodeAnthropicPresetName'),
                      baseUrl: 'https://api.anthropic.com',
                      wire: 'anthropic',
                      defaultModel: 'claude-sonnet-4-6',
                    });
                    setShowAddCustom(true);
                  };
                  const openGatewayPaste = (presetName: string) => {
                    setCustomProviderPreset({
                      name: presetName,
                      baseUrl: cc.baseUrl,
                      wire: 'anthropic',
                      defaultModel: cc.defaultModel,
                    });
                    setShowAddCustom(true);
                  };

                  if (cc.userType === 'parse-error') {
                    // Translate the sentinel before feeding the banner. V8
                    // JSON.parse errors pass through as-is.
                    const rawReason = cc.warnings[0] ?? '';
                    const reason =
                      rawReason === PARSE_REASON_NOT_JSON_OBJECT
                        ? t('settings.providers.import.claudeCodeParseErrorReasonNotObject')
                        : rawReason || t('settings.common.unknownError');
                    return (
                      <>
                        <ParseErrorBanner
                          reason={reason}
                          path={cc.settingsPath}
                          onCopyPath={() => handleCopyPath(cc.settingsPath)}
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings.slice(1)} />
                      </>
                    );
                  }
                  if (cc.userType === 'oauth-only') {
                    return (
                      <>
                        <OAuthSubscriptionBanner
                          onDismiss={dismiss}
                          onIHaveKey={openAnthropicPaste}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  if (cc.userType === 'has-api-key') {
                    const source =
                      cc.apiKeySource === 'shell-env'
                        ? t('settings.providers.import.claudeCodeHasKeySourceEnv')
                        : t('settings.providers.import.claudeCodeHasKeySourceSettings');
                    return (
                      <>
                        <ImportBanner
                          label={t('settings.providers.import.claudeCodeHasKeyBody', {
                            source,
                            baseUrl: displayBaseUrl,
                          })}
                          onImport={handleImportClaudeCode}
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  if (cc.userType === 'local-proxy') {
                    return (
                      <>
                        <ImportBanner
                          tone="info"
                          label={t('settings.providers.import.claudeCodeLocalProxyBody', {
                            baseUrl: displayBaseUrl,
                          })}
                          actionLabel={t('settings.providers.import.claudeCodeLocalProxyAction')}
                          onImport={() =>
                            openGatewayPaste(
                              t('settings.providers.import.claudeCodeLocalProxyPresetName'),
                            )
                          }
                          onDismiss={dismiss}
                        />
                        <WarningsList warnings={cc.warnings} />
                      </>
                    );
                  }
                  // remote-gateway
                  return (
                    <>
                      <ImportBanner
                        tone="info"
                        label={t('settings.providers.import.claudeCodeRemoteGatewayBody', {
                          baseUrl: displayBaseUrl,
                        })}
                        actionLabel={t('settings.providers.import.claudeCodeRemoteGatewayAction')}
                        onImport={() =>
                          openGatewayPaste(
                            t('settings.providers.import.claudeCodeRemoteGatewayPresetName'),
                          )
                        }
                        onDismiss={dismiss}
                      />
                      <WarningsList warnings={cc.warnings} />
                    </>
                  );
                })()}
            </div>
          )}
        <div className="flex items-center justify-between gap-[var(--space-3)] min-h-[var(--size-control-sm)]">
          <SectionTitle>{t('settings.providers.sectionTitle')}</SectionTitle>
          <AddProviderMenu
            open={showAddMenu}
            setOpen={setShowAddMenu}
            hasClaudeCodeImported={rows.some((r) => r.provider === 'claude-code-imported')}
            hasOllamaImported={rows.some((r) => r.provider === 'ollama')}
            onImportCodex={() => {
              setShowAddMenu(false);
              void handleImportCodex();
            }}
            onImportClaudeCode={() => {
              setShowAddMenu(false);
              void handleImportClaudeCode();
            }}
            onAddOllama={() => {
              setShowAddMenu(false);
              void handleAddOllama();
            }}
            onAddCustom={() => {
              setShowAddMenu(false);
              setShowAddCustom(true);
            }}
            onAddCliProxyApi={() => {
              setShowAddMenu(false);
              setCustomProviderPreset({
                name: 'CLIProxyAPI',
                baseUrl: 'http://127.0.0.1:8317',
                wire: 'anthropic',
                defaultModel: '',
              });
              setShowAddCustom(true);
            }}
          />
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-[var(--text-sm)] text-[var(--color-text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('settings.common.loading')}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-6 text-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
            {t('settings.providers.empty')}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <ProviderCard
                key={row.provider}
                row={row}
                config={config}
                onDelete={handleDelete}
                onActivate={handleActivate}
                onEdit={handleEdit}
                onRowChanged={(next) =>
                  setRows((prev) => prev.map((r) => (r.provider === next.provider ? next : r)))
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
