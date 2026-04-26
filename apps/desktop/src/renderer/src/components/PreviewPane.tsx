import { useT } from '@open-codesign/i18n';
import {
  type ElementRectsMessage,
  type IframeConsoleMessage,
  type IframeErrorMessage,
  type OverlayMessage,
  buildSrcdoc,
  isElementRectsMessage,
  isIframeConsoleMessage,
  isIframeErrorMessage,
  isOverlayMessage,
} from '@open-codesign/runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../preview/EmptyState';
import { ErrorState } from '../preview/ErrorState';
import { useCodesignStore } from '../store';
import { CanvasErrorBar } from './CanvasErrorBar';
import { CanvasTabBar } from './CanvasTabBar';
import { ConsolePanel } from './ConsolePanel';
import { FilesTabView } from './FilesTabView';
import { HistoryPanel } from './HistoryPanel';
import { PageTabBar } from './PageTabBar';
import { PhoneFrame } from './PhoneFrame';
import { PreviewToolbar, type PreviewToolbarExternalProps } from './PreviewToolbar';
import { TweakPanel } from './TweakPanel';
import { CommentBubble } from './comment/CommentBubble';
import { PinOverlay } from './comment/PinOverlay';

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

export function postModeToPreviewWindow(
  win: Window | null | undefined,
  mode: string,
  onError: (message: string) => void,
): boolean {
  if (!win) return false;
  try {
    win.postMessage({ __codesign: true, type: 'SET_MODE', mode }, '*');
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    onError(`SET_MODE postMessage failed: ${reason}`);
    return false;
  }
}

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

export function stablePreviewSourceKey(source: string): string {
  const head = source.trimStart().slice(0, 2048).toLowerCase();
  // Full HTML documents do not get the JSX tweaks bridge injected, so token
  // changes must invalidate srcdoc and force a reload to take effect.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return source;
  return source
    .replace(
      /\/\*\s*EDITMODE-BEGIN\s*\*\/[\s\S]*?\/\*\s*EDITMODE-END\s*\*\//g,
      '/*EDITMODE-BEGIN*/__STABLE__/*EDITMODE-END*/',
    )
    .replace(
      /\/\*\s*TWEAK-SCHEMA-BEGIN\s*\*\/[\s\S]*?\/\*\s*TWEAK-SCHEMA-END\s*\*\//g,
      '/*TWEAK-SCHEMA-BEGIN*/__STABLE__/*TWEAK-SCHEMA-END*/',
    );
}

export type AllowedPreviewMessageType =
  | 'ELEMENT_SELECTED'
  | 'IFRAME_ERROR'
  | 'ELEMENT_RECTS'
  | 'CONSOLE_LOG';

export interface PreviewMessageHandlers {
  onElementSelected: (msg: OverlayMessage) => void;
  onIframeError: (msg: IframeErrorMessage) => void;
  onElementRects: (msg: ElementRectsMessage) => void;
  onConsoleLog: (msg: IframeConsoleMessage) => void;
}

export type PreviewMessageOutcome =
  | { status: 'handled'; type: AllowedPreviewMessageType }
  | { status: 'rejected'; reason: 'envelope' | 'unknown-type' | 'shape'; type?: string };

export function handlePreviewMessage(
  data: unknown,
  handlers: PreviewMessageHandlers,
): PreviewMessageOutcome {
  if (typeof data !== 'object' || data === null) {
    return { status: 'rejected', reason: 'envelope' };
  }
  const envelope = data as { __codesign?: unknown; type?: unknown };
  if (envelope.__codesign !== true || typeof envelope.type !== 'string') {
    return { status: 'rejected', reason: 'envelope' };
  }

  switch (envelope.type) {
    case 'ELEMENT_SELECTED':
      if (isOverlayMessage(data)) {
        handlers.onElementSelected(data);
        return { status: 'handled', type: 'ELEMENT_SELECTED' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'IFRAME_ERROR':
      if (isIframeErrorMessage(data)) {
        handlers.onIframeError(data);
        return { status: 'handled', type: 'IFRAME_ERROR' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'ELEMENT_RECTS':
      if (isElementRectsMessage(data)) {
        handlers.onElementRects(data);
        return { status: 'handled', type: 'ELEMENT_RECTS' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    case 'CONSOLE_LOG':
      if (isIframeConsoleMessage(data)) {
        handlers.onConsoleLog(data);
        return { status: 'handled', type: 'CONSOLE_LOG' };
      }
      return { status: 'rejected', reason: 'shape', type: envelope.type };
    default:
      return { status: 'rejected', reason: 'unknown-type', type: envelope.type };
  }
}

const COMMENT_HINT_CLASS =
  'absolute left-[var(--space-5)] top-[var(--space-5)] z-10 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--color-text-secondary)] shadow-[var(--shadow-soft)] backdrop-blur';

interface PreviewSlotProps {
  designId: string;
  html: string;
  active: boolean;
  viewport: 'mobile' | 'tablet' | 'desktop';
  zoom: number;
  showCommentUi: boolean;
  commentHintLabel: string;
  pinOverlay: React.ReactNode;
  interactionMode: string;
  registerIframe: (designId: string, el: HTMLIFrameElement | null) => void;
  onIframeError: (message: string) => void;
  onIframeLoaded: (designId: string) => void;
}

// One iframe per pool entry. Hidden (display:none) when not active, but kept
// in the DOM so its document — already parsed HTML, executed scripts, laid
// out — survives design switches. That's the whole point of the pool. The
// srcDocStableKey trick is per-slot so token-only tweaks via postMessage
// don't rebuild the document (~300-500ms blank on JSX cards).
function PreviewSlot({
  designId,
  html,
  active,
  viewport,
  zoom,
  showCommentUi,
  commentHintLabel,
  pinOverlay,
  interactionMode,
  registerIframe,
  onIframeError,
  onIframeLoaded,
}: PreviewSlotProps) {
  const srcDocStableKey = useMemo(() => stablePreviewSourceKey(html), [html]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: srcDocStableKey is the intentional dependency. html flows through naturally because the factory closes over it and re-runs whenever the stable key flips, which is exactly when structural changes (anything outside EDITMODE / TWEAK_SCHEMA markers) are present.
  const srcDoc = useMemo(() => buildSrcdoc(html), [srcDocStableKey]);

  const setRef = useCallback(
    (el: HTMLIFrameElement | null) => registerIframe(designId, el),
    [designId, registerIframe],
  );

  const isMobile = viewport === 'mobile';
  const scale = zoom / 100;
  const inversePct = `${10000 / zoom}%`;

  const rawIframe = (
    <iframe
      ref={setRef}
      title={`design-preview-${designId}`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={(e) => {
        // Once the iframe's document has actually loaded, its in-page message
        // handler is ready — this is the reliable moment to (re)post SET_MODE.
        // The parent's currentDesignId useEffect can fire before the document
        // loads, so that post may be dropped. Only re-post for the active
        // slot so we don't redirect background iframes into comment mode.
        if (!active) return;
        const target = e.currentTarget as HTMLIFrameElement;
        postModeToPreviewWindow(target.contentWindow, interactionMode, onIframeError);
        // The parent's WATCH_SELECTORS post can race past a freshly-mounted
        // iframe before its message listener installs. Ping the parent so it
        // re-broadcasts after load has confirmed the overlay is live.
        onIframeLoaded(designId);
      }}
      className={
        isMobile
          ? 'block w-full h-full bg-transparent border-0'
          : 'w-full h-full bg-transparent border-0'
      }
    />
  );
  const iframe =
    zoom === 100 ? (
      rawIframe
    ) : (
      <div
        className="origin-top-left"
        style={{ transform: `scale(${scale})`, width: inversePct, height: inversePct }}
      >
        {rawIframe}
      </div>
    );

  let body: React.ReactNode;
  if (isMobile) {
    body = (
      <div className="min-h-full p-6 flex flex-col items-center justify-center overflow-auto">
        <div className="relative inline-flex">
          <PhoneFrame>{iframe}</PhoneFrame>
          {active ? pinOverlay : null}
        </div>
      </div>
    );
  } else if (viewport === 'tablet') {
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
          {showCommentUi && active ? (
            <div className={COMMENT_HINT_CLASS}>{commentHintLabel}</div>
          ) : null}
          {iframe}
          {active ? pinOverlay : null}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="h-full w-full relative">
        {showCommentUi && active ? (
          <div className={COMMENT_HINT_CLASS}>{commentHintLabel}</div>
        ) : null}
        {iframe}
        {active ? pinOverlay : null}
      </div>
    );
  }

  return (
    <div hidden={!active} className="h-full w-full">
      {body}
    </div>
  );
}

export function PreviewPane({ onPickStarter }: PreviewPaneProps) {
  const t = useT();
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const setPreviewHtml = useCodesignStore((s) => s.setPreviewHtml);
  const previewHtmlByDesign = useCodesignStore((s) => s.previewHtmlByDesign);
  const recentDesignIds = useCodesignStore((s) => s.recentDesignIds);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const isGenerating = useCodesignStore(
    (s) => s.currentDesignId !== null && s.activeGenerations.has(s.currentDesignId),
  );
  const designs = useCodesignStore((s) => s.designs);
  const chatMessages = useCodesignStore((s) => s.chatMessages);
  const canvasTabs = useCodesignStore((s) => s.canvasTabs);
  const activeCanvasTab = useCodesignStore((s) => s.activeCanvasTab);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const retry = useCodesignStore((s) => s.retryLastPrompt);
  const clearError = useCodesignStore((s) => s.clearError);
  const pushIframeError = useCodesignStore((s) => s.pushIframeError);
  const pushConsoleLog = useCodesignStore((s) => s.pushConsoleLog);
  const selectCanvasElement = useCodesignStore((s) => s.selectCanvasElement);
  const previewViewport = useCodesignStore((s) => s.previewViewport);
  const previewZoom = useCodesignStore((s) => s.previewZoom);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const comments = useCodesignStore((s) => s.comments);
  const currentSnapshotId = useCodesignStore((s) => s.currentSnapshotId);
  const commentBubble = useCodesignStore((s) => s.commentBubble);
  const openCommentBubble = useCodesignStore((s) => s.openCommentBubble);
  const closeCommentBubble = useCodesignStore((s) => s.closeCommentBubble);
  const submitComment = useCodesignStore((s) => s.submitComment);
  const applyLiveRects = useCodesignStore((s) => s.applyLiveRects);
  const clearLiveRects = useCodesignStore((s) => s.clearLiveRects);
  const liveRects = useCodesignStore((s) => s.liveRects);
  const pageFiles = useCodesignStore((s) => s.pageFiles);
  const activePagePath = useCodesignStore((s) => s.activePagePath);
  const activeTab = canvasTabs[activeCanvasTab];
  const showFilesOverPreview =
    activeTab?.kind === 'files' && typeof previewHtml === 'string' && previewHtml.length > 0;
  const [filesLayerKept, setFilesLayerKept] = useState(false);
  const hasPreviewText = typeof previewHtml === 'string' && previewHtml.length > 0;
  const filesLayerInDom = hasPreviewText && (showFilesOverPreview || filesLayerKept);

  // Active iframe ref consumed by TweakPanel (postMessage target) and by the
  // window.message guard. We re-point this whenever the active design changes
  // or the active iframe element re-mounts.
  const [showHistory, setShowHistory] = useState(false);
  const [showCodeView, setShowCodeView] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Unsent bubble drafts, keyed by bubbleKey (edit:<id> | new:<selector>).
  // Lives across bubble remounts so switching to another chip / element and
  // coming back restores the text the user had typed. Cleared on successful
  // submit; explicit close (Esc / ×) deliberately preserves.
  const bubbleDraftsRef = useRef<Map<string, string>>(new Map());
  const iframesByDesign = useRef<Map<string, HTMLIFrameElement>>(new Map());
  // Bumped every time the active iframe fires onLoad — used to re-trigger
  // the WATCH_SELECTORS effect so we don't race past overlay installation
  // on first mount.
  const [iframeLoadTick, setIframeLoadTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on design id only — effect body is intentionally idempotent
  useEffect(() => {
    setFilesLayerKept(false);
  }, [currentDesignId]);
  useEffect(() => {
    if (showFilesOverPreview) setFilesLayerKept(true);
  }, [showFilesOverPreview]);

  const registerIframe = useCallback((designId: string, el: HTMLIFrameElement | null) => {
    if (el) {
      iframesByDesign.current.set(designId, el);
    } else {
      iframesByDesign.current.delete(designId);
    }
  }, []);

  const handleIframeLoaded = useCallback(
    (designId: string) => {
      if (designId === currentDesignId) setIframeLoadTick((t) => t + 1);
    },
    [currentDesignId],
  );

  // When the active design changes, retarget iframeRef and re-broadcast the
  // current interaction mode. Background iframes keep their last mode — fine,
  // they're inert until reactivated.
  useEffect(() => {
    if (currentDesignId === null) {
      iframeRef.current = null;
      return;
    }
    const el = iframesByDesign.current.get(currentDesignId) ?? null;
    iframeRef.current = el;
    if (el) {
      postModeToPreviewWindow(el.contentWindow, interactionMode, pushIframeError);
    }
    // New iframe / new design → liveRects from the old one are stale.
    clearLiveRects();
  }, [currentDesignId, interactionMode, pushIframeError, clearLiveRects]);

  // Tell the sandbox which selectors to track. The sandbox re-measures each
  // on scroll/resize and broadcasts ELEMENT_RECTS; we merge into liveRects.
  // Selectors: all comments on the current snapshot + the active bubble's
  // selector (usually the freshly-pinned one, included for the moment
  // between click and save).
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentDesignId and iframeLoadTick are deliberate triggers — iframeRef.current is a ref so biome can't see it swap when the active design changes, and we must wait for the iframe's onLoad before the overlay's message listener exists (otherwise the post is dropped).
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const selectors = new Set<string>();
    if (currentSnapshotId) {
      for (const c of comments) {
        if (c.snapshotId === currentSnapshotId) selectors.add(c.selector);
      }
    }
    if (commentBubble) selectors.add(commentBubble.selector);
    try {
      win.postMessage(
        { __codesign: true, type: 'WATCH_SELECTORS', selectors: Array.from(selectors) },
        '*',
      );
    } catch {
      /* sandbox gone — retry happens next render */
    }
  }, [comments, currentSnapshotId, commentBubble, currentDesignId, iframeLoadTick]);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      // Only accept messages from the ACTIVE iframe — background pool members
      // are inert from the user's POV and their messages would race with the
      // foreground design's state.
      if (!isTrustedPreviewMessageSource(event.source, iframeRef.current?.contentWindow)) return;

      const outcome = handlePreviewMessage(event.data, {
        onElementSelected: (msg) => {
          const scaled = scaleRectForZoom(msg.rect, previewZoom);
          selectCanvasElement({
            selector: msg.selector,
            tag: msg.tag,
            outerHTML: msg.outerHTML,
            rect: scaled,
          });
          openCommentBubble({
            selector: msg.selector,
            tag: msg.tag,
            outerHTML: msg.outerHTML,
            rect: scaled,
            ...(typeof msg.parentOuterHTML === 'string' && msg.parentOuterHTML.length > 0
              ? { parentOuterHTML: msg.parentOuterHTML }
              : {}),
          });
        },
        onIframeError: (msg) =>
          pushIframeError(formatIframeError(msg.kind, msg.message, msg.source, msg.lineno)),
        onElementRects: (msg) => {
          applyLiveRects(msg.entries);
        },
        onConsoleLog: (msg) =>
          pushConsoleLog({ level: msg.level, args: msg.args, timestamp: msg.timestamp }),
      });

      if (outcome.status === 'rejected' && outcome.reason === 'unknown-type') {
        console.warn('[PreviewPane] rejected iframe message type:', outcome.type);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [
    pushIframeError,
    pushConsoleLog,
    selectCanvasElement,
    openCommentBubble,
    previewZoom,
    applyLiveRects,
  ]);

  // Pool entries: active design first (using the freshest in-memory
  // previewHtml), then any other recently-visited designs that still have a
  // cached preview. Store-side LRU bounds the size; we just render what's
  // handed to us.
  const poolEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; html: string }> = [];
    if (currentDesignId !== null) {
      // When viewing a non-index page, show that page's content instead.
      const pageHtml = activePagePath !== 'index.html' ? pageFiles[activePagePath] : undefined;
      const html = pageHtml ?? previewHtml ?? previewHtmlByDesign[currentDesignId];
      if (typeof html === 'string' && html.length > 0) {
        out.push({ id: currentDesignId, html });
        seen.add(currentDesignId);
      }
    }
    for (const id of recentDesignIds) {
      if (seen.has(id)) continue;
      const html = previewHtmlByDesign[id];
      if (typeof html === 'string' && html.length > 0) {
        out.push({ id, html });
        seen.add(id);
      }
    }
    return out;
  }, [
    currentDesignId,
    previewHtml,
    previewHtmlByDesign,
    recentDesignIds,
    activePagePath,
    pageFiles,
  ]);

  const showCommentUi = interactionMode === 'comment';
  const snapshotComments = currentSnapshotId
    ? comments.filter((c) => c.snapshotId === currentSnapshotId)
    : [];
  const pinOverlay = (
    <PinOverlay
      comments={snapshotComments}
      zoom={previewZoom}
      liveRects={liveRects}
      onPinClick={(c) => {
        const live = liveRects[c.selector] ?? c.rect;
        openCommentBubble({
          selector: c.selector,
          tag: c.tag,
          outerHTML: c.outerHTML,
          rect: scaleRectForZoom(live, previewZoom),
          existingCommentId: c.id,
          initialText: c.text,
        });
      }}
    />
  );

  const activeHasHtml =
    currentDesignId !== null && poolEntries.some((e) => e.id === currentDesignId);

  // When a design already has persisted content (thumbnail from a prior save,
  // or chat history), the preview IS coming — we're just waiting on the IPC
  // round-trip for the snapshot. Show a skeleton instead of the new-design
  // welcome screen so users don't read the transient state as "load failed".
  const currentDesign = currentDesignId ? designs.find((d) => d.id === currentDesignId) : undefined;
  const designHasContent =
    currentDesign !== undefined &&
    ((currentDesign.thumbnailText !== null && currentDesign.thumbnailText.length > 0) ||
      chatMessages.length > 0);

  let body: React.ReactNode;
  // Only take over the whole pane with ErrorState when there's nothing to
  // show yet. If the agent produced a preview before failing on the last
  // step (common with token-overflow / validation errors), keep the preview
  // visible — the user can still inspect and tweak what did generate.
  // A small dismissible error banner surfaces via CanvasErrorBar / toast.
  if (errorMessage && !previewHtml) {
    body = (
      <ErrorState
        message={errorMessage}
        onRetry={() => {
          void retry();
        }}
        onDismiss={clearError}
      />
    );
  } else {
    // Stack Files above the pool and toggle with `hidden` (HubView pattern) so
    // iframes are not torn down on tab switch.
    // Pool slots stay mounted even when the current design has no preview —
    // background iframes for recently-visited designs keep their documents
    // alive for instant switch-back. EmptyState is overlaid in the same
    // stacking context when the active design has no content yet.
    const previewStack = (
      <div className="relative h-full w-full">
        {poolEntries.map((entry) => (
          <PreviewSlot
            key={entry.id}
            designId={entry.id}
            html={entry.html}
            active={entry.id === currentDesignId}
            viewport={previewViewport}
            zoom={previewZoom}
            showCommentUi={showCommentUi}
            commentHintLabel={t('preview.commentModeHint')}
            pinOverlay={pinOverlay}
            interactionMode={interactionMode}
            registerIframe={registerIframe}
            onIframeError={pushIframeError}
            onIframeLoaded={handleIframeLoaded}
          />
        ))}
        {!activeHasHtml ? (
          designHasContent ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)]">
              <div className="w-[60%] max-w-[720px] aspect-[4/3] rounded-[var(--radius-lg)] bg-[linear-gradient(110deg,var(--color-background-secondary)_0%,rgba(0,0,0,0.03)_40%,var(--color-background-secondary)_80%)] animate-pulse" />
            </div>
          ) : (
            <EmptyState onPickStarter={onPickStarter} />
          )
        ) : null}
      </div>
    );
    body = (
      <div className="relative h-full w-full">
        {filesLayerInDom ? (
          <div
            className="absolute inset-0 z-10 min-h-0"
            hidden={!showFilesOverPreview}
            aria-hidden={!showFilesOverPreview}
          >
            <FilesTabView />
          </div>
        ) : null}
        <div
          className="absolute inset-0 min-h-0"
          hidden={showFilesOverPreview}
          aria-hidden={showFilesOverPreview}
        >
          {previewStack}
        </div>
      </div>
    );
  }

  const hasTabs = canvasTabs.length > 0;
  const isWelcome = !errorMessage && !previewHtml && !designHasContent;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex flex-col min-h-0 flex-1">
        {isWelcome ? null : (
          <div className="flex items-stretch justify-between gap-[var(--space-2)] border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)] pl-[var(--space-2)]">
            {hasTabs ? <CanvasTabBar /> : <div />}
            <PreviewToolbar
              onToggleHistory={() => setShowHistory((v) => !v)}
              historyOpen={showHistory}
              showCodeView={showCodeView}
              onToggleCodeView={() => setShowCodeView((v) => !v)}
            />
          </div>
        )}
        <PageTabBar />
        <CanvasErrorBar />
        <div className="relative flex-1 overflow-hidden">
          {showCodeView && previewHtml ? (
            <CodeViewPanel html={previewHtml} isGenerating={isGenerating} onSave={setPreviewHtml} />
          ) : (
            body
          )}
          {!showCodeView && previewHtml ? <TweakPanel iframeRef={iframeRef} /> : null}
          {showHistory ? <HistoryPanel onClose={() => setShowHistory(false)} /> : null}
        </div>
        <ConsolePanel />
        {commentBubble && interactionMode === 'comment'
          ? (() => {
              const liveForBubble = liveRects[commentBubble.selector];
              const scaled = liveForBubble
                ? scaleRectForZoom(liveForBubble, previewZoom)
                : commentBubble.rect;
              const existingId = commentBubble.existingCommentId;
              // Keying by comment id (when editing) rather than selector alone
              // means two comments on the same element each get their own draft
              // state and don't stomp each other on reopen.
              const bubbleKey = existingId ? `edit:${existingId}` : `new:${commentBubble.selector}`;
              // Draft precedence: prior unsent draft for this anchor > DB text
              // on a reopened chip > empty. This preserves mid-typing context
              // when the user clicks another chip and comes back.
              const stashed = bubbleDraftsRef.current.get(bubbleKey);
              const initialText = stashed ?? commentBubble.initialText;
              return (
                <CommentBubble
                  key={bubbleKey}
                  selector={commentBubble.selector}
                  tag={commentBubble.tag}
                  outerHTML={commentBubble.outerHTML}
                  rect={scaled}
                  {...(initialText !== undefined ? { initialText } : {})}
                  onDraftChange={(text) => {
                    if (text.length === 0) bubbleDraftsRef.current.delete(bubbleKey);
                    else bubbleDraftsRef.current.set(bubbleKey, text);
                  }}
                  onClose={() => {
                    const win = iframeRef.current?.contentWindow;
                    if (win) {
                      try {
                        win.postMessage({ __codesign: true, type: 'CLEAR_PIN' }, '*');
                      } catch {
                        /* noop */
                      }
                    }
                    closeCommentBubble();
                  }}
                  onSendToClaude={async (text: string) => {
                    const row = await submitComment({
                      kind: 'edit',
                      selector: commentBubble.selector,
                      tag: commentBubble.tag,
                      outerHTML: commentBubble.outerHTML,
                      rect: commentBubble.rect,
                      text,
                      scope: 'element',
                      ...(existingId ? { existingCommentId: existingId } : {}),
                      ...(commentBubble.parentOuterHTML
                        ? { parentOuterHTML: commentBubble.parentOuterHTML }
                        : {}),
                    });
                    // On failure (no snapshot, IPC error, duplicate) keep the
                    // bubble open so the user's draft survives. A toast has
                    // already been surfaced by the store layer.
                    if (!row) return;
                    // Persisted — wipe the stashed draft so the next open
                    // starts clean (a reopened chip re-reads from DB).
                    bubbleDraftsRef.current.delete(bubbleKey);
                    const win = iframeRef.current?.contentWindow;
                    if (win) {
                      try {
                        win.postMessage({ __codesign: true, type: 'CLEAR_PIN' }, '*');
                      } catch {
                        /* noop */
                      }
                    }
                    closeCommentBubble();
                    // Stage only — user clicks the "Apply" button on the chip bar
                    // to send all accumulated edits in one go.
                  }}
                />
              );
            })()
          : null}
      </div>
    </div>
  );
}

/* ── Code view panel ─────────────────────────────────────────────────── */

interface CodeViewPanelProps {
  html: string;
  isGenerating: boolean;
  onSave: (html: string) => void;
}

function CodeViewPanel({ html, isGenerating, onSave }: CodeViewPanelProps) {
  const [draft, setDraft] = useState(html);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== html;

  // Keep draft in sync when html changes externally (e.g. agent streaming)
  useEffect(() => {
    setDraft(html);
  }, [html]);

  function handleSave(): void {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function handleKeyDown(e: import('react').KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (!isGenerating) handleSave();
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-background-secondary)]">
      {isGenerating ? (
        <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1_5)] text-[11.5px] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] border-b border-[var(--color-accent)]/20 text-[var(--color-text-secondary)]">
          <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-accent)] animate-pulse shrink-0" />
          Code view is read-only while the agent is running.
        </div>
      ) : dirty ? (
        <div className="flex items-center justify-between gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1_5)] text-[11.5px] bg-[color-mix(in_srgb,#f59e0b_10%,transparent)] border-b border-[#f59e0b]/30 text-[var(--color-text-secondary)]">
          <span>Unsaved edits — save to apply to preview.</span>
          <button
            type="button"
            onClick={handleSave}
            className="shrink-0 inline-flex items-center h-[22px] px-[10px] rounded-[var(--radius-sm)] text-[11px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-100"
          >
            {saved ? 'Saved ✓' : 'Save (⌘S)'}
          </button>
        </div>
      ) : null}
      <textarea
        value={draft}
        onChange={(e) => !isGenerating && setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        readOnly={isGenerating}
        spellCheck={false}
        className="flex-1 w-full resize-none border-0 bg-transparent p-[var(--space-4)] text-[12.5px] leading-[1.6] font-[ui-monospace,Menlo,monospace] text-[var(--color-text-primary)] outline-none focus:outline-none"
        style={{ tabSize: 2 }}
        aria-label="HTML source"
      />
    </div>
  );
}
