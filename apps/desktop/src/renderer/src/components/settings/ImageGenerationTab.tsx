import { useT } from '@open-codesign/i18n';
import { Image as ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ImageGenerationSettingsView } from '../../../../preload/index';
import { useCodesignStore } from '../../store';
import { Label, NativeSelect, Row, SectionTitle, SegmentedControl } from './primitives';

function defaultImageModelFor(provider: ImageGenerationSettingsView['provider']): string {
  if (provider === 'openrouter') return 'openai/gpt-5.4-image-2';
  if (provider === 'chatgpt-codex') return 'gpt-5.5';
  return 'gpt-image-2';
}

function defaultImageBaseUrlFor(provider: ImageGenerationSettingsView['provider']): string {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'chatgpt-codex') return 'https://chatgpt.com/backend-api';
  return 'https://api.openai.com/v1';
}

function ImageGenerationPanel() {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [settings, setSettings] = useState<ImageGenerationSettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    if (!window.codesign?.imageGeneration) return;
    void window.codesign.imageGeneration
      .get()
      .then((next) => {
        setSettings(next);
        setModel(next.model);
        setBaseUrl(next.baseUrl);
      })
      .catch((err) => {
        pushToast({
          variant: 'error',
          title: t('settings.imageGen.toast.loadFailed', {
            defaultValue: 'Image generation settings failed to load',
          }),
          description: err instanceof Error ? err.message : t('settings.common.unknownError'),
        });
      });
  }, [pushToast, t]);

  async function save(patch: Partial<ImageGenerationSettingsView> & { apiKey?: string }) {
    if (!window.codesign?.imageGeneration) return;
    setSaving(true);
    try {
      const next = await window.codesign.imageGeneration.update(patch);
      setSettings(next);
      setModel(next.model);
      setBaseUrl(next.baseUrl);
      setApiKey('');
      pushToast({
        variant: 'success',
        title: t('settings.imageGen.toast.saved', { defaultValue: 'Image generation saved' }),
      });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.imageGen.toast.saveFailed', {
          defaultValue: 'Image generation settings failed to save',
        }),
        description: err instanceof Error ? err.message : t('settings.common.unknownError'),
      });
    } finally {
      setSaving(false);
    }
  }

  if (settings === null) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] p-[var(--space-4)] text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('settings.common.loading')}
      </div>
    );
  }

  const keyAvailable =
    settings.credentialMode === 'custom' ? settings.hasCustomKey : settings.inheritedKeyAvailable;
  const status: 'ready' | 'needsKey' | 'disabled' = !settings.enabled
    ? 'disabled'
    : keyAvailable
      ? 'ready'
      : 'needsKey';

  const statusStyles: Record<typeof status, string> = {
    ready:
      'bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-[var(--color-success)] border-[color-mix(in_oklab,var(--color-success)_32%,transparent)]',
    needsKey:
      'bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)] text-[var(--color-warning)] border-[color-mix(in_oklab,var(--color-warning)_32%,transparent)]',
    disabled:
      'bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border-[var(--color-border-muted)]',
  };
  const statusLabel =
    status === 'needsKey' && settings.provider === 'chatgpt-codex'
      ? t('settings.imageGen.status.needsChatgptLogin', {
          defaultValue: 'Needs ChatGPT sign-in',
        })
      : t(`settings.imageGen.status.${status}`);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] p-[var(--space-4)] space-y-[var(--space-4)]">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <div className="min-w-0 flex items-start gap-[var(--space-2)]">
          <ImageIcon className="w-4 h-4 mt-0.5 text-[var(--color-text-secondary)]" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-[var(--space-2)]">
              <SectionTitle>{t('settings.imageGen.title')}</SectionTitle>
              <span
                className={`inline-flex items-center h-5 px-1.5 rounded-full border text-[var(--text-xs)] font-medium tracking-wide uppercase ${statusStyles[status]}`}
              >
                {statusLabel}
              </span>
            </div>
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-0.5 leading-[var(--leading-body)]">
              {t('settings.imageGen.hint')}
            </p>
          </div>
        </div>
        <label className="inline-flex items-center gap-[var(--space-2)] shrink-0 text-[var(--text-xs)] text-[var(--color-text-secondary)] select-none">
          <span>{t('settings.imageGen.enabled')}</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving}
            onChange={(e) => void save({ enabled: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)]">
        <Row label={t('settings.imageGen.provider')}>
          <NativeSelect
            value={settings.provider}
            disabled={saving}
            options={[
              { value: 'openai', label: 'OpenAI' },
              {
                value: 'chatgpt-codex',
                label: t('settings.imageGen.chatgptSubscription', {
                  defaultValue: 'ChatGPT subscription',
                }),
              },
              { value: 'openrouter', label: 'OpenRouter' },
            ]}
            onChange={(value) => {
              const provider = value as ImageGenerationSettingsView['provider'];
              void save({
                provider,
                credentialMode: provider === 'chatgpt-codex' ? 'inherit' : settings.credentialMode,
                model: defaultImageModelFor(provider),
                baseUrl: defaultImageBaseUrlFor(provider),
              });
            }}
          />
        </Row>
        <Row label={t('settings.imageGen.credentials')}>
          <SegmentedControl
            value={settings.credentialMode}
            disabled={saving || settings.provider === 'chatgpt-codex'}
            options={[
              { value: 'inherit', label: t('settings.imageGen.inherit') },
              { value: 'custom', label: t('settings.imageGen.customKey') },
            ]}
            onChange={(credentialMode) => void save({ credentialMode })}
          />
        </Row>
      </div>

      {settings.credentialMode === 'custom' ? (
        <div className="flex items-center gap-[var(--space-2)]">
          <input
            type="password"
            value={apiKey}
            disabled={saving}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              settings.maskedKey
                ? t('settings.imageGen.keyPlaceholder', { mask: settings.maskedKey })
                : t('settings.imageGen.newKeyPlaceholder')
            }
            className="min-w-0 flex-1 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={saving || apiKey.trim().length === 0}
            onClick={() => void save({ apiKey })}
            className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.save')}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)]">
        <label className="min-w-0">
          <Label>{t('settings.imageGen.model')}</Label>
          <input
            type="text"
            value={model}
            disabled={saving}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
          />
        </label>
        <label className="min-w-0">
          <Label>{t('settings.imageGen.baseUrl')}</Label>
          <input
            type="url"
            value={baseUrl}
            disabled={saving}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="mt-1 w-full h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)]">
        <Row label={t('settings.imageGen.quality')}>
          <NativeSelect
            value={settings.quality}
            disabled={saving}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            onChange={(quality) =>
              void save({ quality: quality as ImageGenerationSettingsView['quality'] })
            }
          />
        </Row>
        <Row label={t('settings.imageGen.size')}>
          <NativeSelect
            value={settings.size}
            disabled={saving}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '1024x1024', label: '1024 x 1024' },
              { value: '1536x1024', label: '1536 x 1024' },
              { value: '1024x1536', label: '1024 x 1536' },
            ]}
            onChange={(size) => void save({ size: size as ImageGenerationSettingsView['size'] })}
          />
        </Row>
      </div>

      <div className="flex justify-end pt-[var(--space-1)] border-t border-[var(--color-border-muted)]">
        <button
          type="button"
          disabled={
            saving ||
            model.trim().length === 0 ||
            baseUrl.trim().length === 0 ||
            (model === settings.model && baseUrl === settings.baseUrl)
          }
          onClick={() => void save({ model, baseUrl })}
          className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

export function ImageGenerationTab() {
  const t = useT();
  return (
    <div className="space-y-[var(--space-4)]">
      <div>
        <SectionTitle>{t('settings.imageGen.tabTitle')}</SectionTitle>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-1 leading-[var(--leading-body)]">
          {t('settings.imageGen.tabHint')}
        </p>
      </div>
      <ImageGenerationPanel />
    </div>
  );
}
