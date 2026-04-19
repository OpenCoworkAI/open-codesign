import { useT } from '@open-codesign/i18n';
import { buildSrcdoc, isIframeErrorMessage, isOverlayMessage } from '@open-codesign/runtime';
import { useEffect, useRef } from 'react';
import { EmptyState } from '../preview/EmptyState';
import { ErrorState } from '../preview/ErrorState';
import { LoadingState } from '../preview/LoadingState';
import { useCodesignStore } from '../store';
import { CanvasErrorBar } from './CanvasErrorBar';
import { InlineCommentComposer } from './InlineCommentComposer';
import { PhoneFrame } from './PhoneFrame';
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

// Convert a rect reported from inside the sandbox iframe (iframe-internal
// viewport coords) into the parent renderer's viewport coords. The wrapper
// applies `transform: scale(zoom/100)` to a div sized at `100/scale %`, so a
// child at iframe-internal position P appears in the parent at P * scale.
export function scaleRectForZoom(
  rect: { top: number; left: number; width: number; height: number },
  zoomPercent: number,
): { top: number; left: number; width: number; height: number } {
  const scale = zoomPercent / 100;
  return {
    top: rect.top * scale,
    left: rect.left * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

const COMMENT_HINT_CLASS =
  'absolute left-[var(--space-5)] top-[var(--space-5)] z-10 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] backdrop-blur';

export function PreviewPane({ onPickStarter }: PreviewPaneProps) {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const retry = useCodesignStore((s) => s.retryLastPrompt);
  const clearError = useCodesignStore((s) => s.clearError);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const previewViewport = useCodesignStore((s) => s.previewViewport);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;

      if (isOverlayMessage(event.data)) {
        selectCanvasElement({
          selector: event.data.selector,
          tag: event.data.tag,
          outerHTML: event.data.outerHTML,
          rect: scaleRectForZoom(event.data.rect, previewZoom),
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
  }, [pushIframeError, selectCanvasElement, previewZoom]);

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
    const isMobile = previewViewport === 'mobile';
    const rawIframe = (
      <iframe
        ref={iframeRef}
        key={previewHtml.length}
        title="design-preview"
        sandbox="allow-scripts"
        srcDoc={buildSrcdoc(previewHtml)}
        className={
          isMobile
            ? 'block w-full h-full bg-[var(--color-artifact-bg)] border-0'
            : 'w-full h-full bg-[var(--color-artifact-bg)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] border border-[var(--color-border)]'
        }
      />
    );
    const scale = previewZoom / 100;
    const inversePct = `${10000 / previewZoom}%`;
    const iframe =
      previewZoom === 100 ? (
        rawIframe
      ) : (
        <div
          className="origin-top-left"
          style={{
            transform: `scale(${scale})`,
            width: inversePct,
            height: inversePct,
          }}
        >
          {rawIframe}
        </div>
      );

    if (isMobile) {
      body = (
        <div className="min-h-full p-6 flex flex-col items-center justify-center overflow-auto">
          <div className="relative inline-flex">
            <PhoneFrame>{iframe}</PhoneFrame>
            <InlineCommentComposer />
          </div>
        </div>
      );
    } else if (previewViewport === 'tablet') {
      body = (
        <div className="h-full p-6 flex flex-col items-center justify-start overflow-auto">
          <div
            className="relative"
            style={{
              width: 'var(--size-preview-tablet-width)',
              height: 'var(--size-preview-tablet-height)',
              flexShrink: 0,
            }}
          >
            <div className={COMMENT_HINT_CLASS}>{t('preview.clickToComment')}</div>
            {iframe}
            <InlineCommentComposer />
          </div>
        </div>
      );
    } else {
      body = (
        <div className="h-full p-6 flex flex-col items-center justify-start overflow-auto">
          <div
            className="relative"
            style={{
              width: 'min(100%, var(--size-preview-desktop-width))',
              height: 'min(100%, var(--size-preview-desktop-height))',
              flexShrink: 0,
            }}
          >
            <div className={COMMENT_HINT_CLASS}>{t('preview.clickToComment')}</div>
            {iframe}
            <InlineCommentComposer />
          </div>
        </div>
      );
    }
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
