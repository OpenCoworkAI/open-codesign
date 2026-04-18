import { useT } from '@open-codesign/i18n';
import { buildSrcdoc } from '@open-codesign/runtime';
import { getDemos } from '@open-codesign/templates';
import { Button } from '@open-codesign/ui';
import { Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useCodesignStore } from './store';

export function App() {
  const t = useT();
  const messages = useCodesignStore((s) => s.messages);
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const locale = useCodesignStore((s) => s.locale);
  const [prompt, setPrompt] = useState('');

  const demos = getDemos(locale);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    void sendPrompt(prompt);
    setPrompt('');
  }

  return (
    <div className="h-full grid grid-cols-[380px_1fr] bg-[var(--color-background)]">
      <aside className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <header className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--color-accent)]" />
            <span className="font-semibold text-[var(--color-text-primary)]">
              {t('common.appName')}
            </span>
            <span className="ml-auto text-xs text-[var(--color-text-muted)]">
              {t('common.preAlpha')}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 ? (
            <div>
              <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                {t('preview.empty.starterChip')}
              </p>
              <ul className="space-y-2">
                {demos.map((demo) => (
                  <li key={demo.id}>
                    <button
                      type="button"
                      onClick={() => setPrompt(demo.prompt)}
                      className="w-full text-left px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">
                        {demo.title}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {demo.description}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: tier-1 chat list with no reordering
                key={`${m.role}-${i}`}
                className={`px-3 py-2 rounded-[var(--radius-md)] text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)]'
                }`}
              >
                {m.content}
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-[var(--color-border)] p-3 flex gap-2"
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            disabled={isGenerating}
            className="flex-1 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <Button
            type="submit"
            size="md"
            disabled={isGenerating || !prompt.trim()}
            aria-label={t('common.send')}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </aside>

      <main className="flex flex-col">
        <header className="h-12 px-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">
            {previewHtml ? t('preview.ready') : t('preview.noDesign')}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">{t('common.tagline')}</span>
        </header>
        <div className="flex-1 p-6 overflow-auto">
          {previewHtml ? (
            <iframe
              key={previewHtml.length}
              title="design-preview"
              sandbox="allow-scripts"
              srcDoc={buildSrcdoc(previewHtml)}
              className="w-full h-full bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] border border-[var(--color-border)]"
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-[var(--color-accent)]" />
                </div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                  {t('preview.empty.title')}
                </h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('preview.empty.body')}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
