import { useT } from '@open-codesign/i18n';
import { Button } from '@open-codesign/ui';
import { AlertTriangle, Copy, RotateCw } from 'lucide-react';
import { useState } from 'react';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  onDismiss?: () => void;
}

export function ErrorState({ message, onRetry, onDismiss }: ErrorStateProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-[var(--radius-2xl)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-[var(--radius-full)] bg-[var(--color-accent-muted)] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[var(--text-base)] font-semibold text-[var(--color-text-primary)]">
              {t('preview.error.title')}
            </h3>
            <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] mt-1">
              {t('preview.error.body')}
            </p>
          </div>
        </div>
        <pre className="text-[var(--text-xs)] text-[var(--color-text-secondary)] bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 mb-4 max-h-32 overflow-auto whitespace-pre-wrap break-words">
          {message}
        </pre>
        <div className="flex items-center gap-2 justify-end">
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t('common.close')}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy className="w-4 h-4" />
            {copied ? t('common.copied') : t('preview.error.copyError')}
          </Button>
          <Button variant="primary" size="sm" onClick={onRetry}>
            <RotateCw className="w-4 h-4" />
            {t('common.retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
