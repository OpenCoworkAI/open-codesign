import { useT } from '@open-codesign/i18n';
import { buildSrcdoc, isIframeErrorMessage, isOverlayMessage } from '@open-codesign/runtime';
import { useEffect, useRef } from 'react';
import { EmptyState } from '../preview/EmptyState';
import { ErrorState } from '../preview/ErrorState';
import { LoadingState } from '../preview/LoadingState';
import { useCodesignStore } from '../store';
import { CanvasErrorBar } from './CanvasErrorBar';
import { InlineCommentComposer } from './InlineCommentComposer';
import { PreviewToolbar } from './PreviewToolbar';

export interface PreviewPaneProps {
  onPickStarter: (prompt: string) => void;
}

export function formatIframeError(
  kind: string,
  message: string,
  source?: string,
  lineno?: number,
): string {
  const location = source && lineno ? ` (${source}:${lineno})` : '';
  return `${kind}: ${message}${location}`;
}

export function isTrustedPreviewMessageSource(
  source: MessageEventSource | null,
  previewWindow: Window | null | undefined,
): boolean {
  return source !== null && source === previewWindow;
}

export function PreviewPane({ onPickStarter }: PreviewPaneProps) {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const retry = useCodesignStore((s) => s.retryLastPrompt);
  const clearError = useCodesignStore((s) => s.clearError);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;

      if (isOverlayMessage(event.data)) {
        selectCanvasElement({
          selector: event.data.selector,
          tag: event.data.tag,
          outerHTML: event.data.outerHTML,
          rect: event.data.rect,
        });
        return;
      }

      if (isIframeErrorMessage(event.data)) {
        pushIframeError(
          formatIframeError(
            event.data.kind,
            event.data.message,
            event.data.source,
            event.data.lineno,
          ),
        );
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushIframeError, selectCanvasElement]);

  let body: React.ReactNode;
  if (errorMessage) {
    body = (
      <ErrorState
        message={errorMessage}
        onRetry={() => {
          void retry();
        }}
        onDismiss={clearError}
      />
    );
  } else if (isGenerating && !previewHtml) {
    body = <LoadingState />;
  } else if (previewHtml) {
    body = (
      <div className="h-full p-6">
        <div className="relative h-full">
          <div className="absolute left-5 top-5 z-10 rounded-full border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_88%,transparent)] px-3 py-1 text-[var(--text-xs)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] backdrop-blur">
            {t('preview.clickToComment')}
          </div>
          <iframe
            ref={iframeRef}
            key={previewHtml.length}
            title="design-preview"
            sandbox="allow-scripts"
            srcDoc={buildSrcdoc(previewHtml)}
            className="w-full h-full bg-[var(--color-surface)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] border border-[var(--color-border)]"
          />
          <InlineCommentComposer />
        </div>
      </div>
    );
  } else {
    body = <EmptyState onPickStarter={onPickStarter} />;
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PreviewToolbar />
      <CanvasErrorBar />
      <div className="flex-1 overflow-auto">{body}</div>
    </div>
  );
}
