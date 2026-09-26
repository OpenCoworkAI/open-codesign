import {
  type ElementRectsMessage,
  type IframeErrorMessage,
  isElementRectsMessage,
  isIframeErrorMessage,
  isOverlayMessage,
  isSourceEditSelection,
  type OverlayMessage,
  type SourceEditSelection,
} from '@open-codesign/runtime';
import {
  type SourceEditOperation,
  type SourceEditTarget,
  sourceEditFieldKey,
} from '@open-codesign/shared';

export interface SourceEditAncestor {
  selector: string;
  tagName: string;
}
export interface SourceEditValidationRequest {
  targetId: string;
  sourceHash: string;
  previewRevision: string;
  fieldKey: string;
}

export function sourceEditFieldState(
  target: SourceEditTarget,
  operation: SourceEditOperation,
  states: SourceEditSelection['fieldStates'],
): NonNullable<SourceEditSelection['fieldStates']>[number] {
  const key = sourceEditFieldKey(operation);
  const matching = states?.filter((state) => state.key === key);
  if (matching?.length === 1 && matching[0]) return matching[0];
  return {
    key,
    status: states === undefined && target.textLayout === undefined ? 'ready' : 'unmapped',
  };
}

/** A live DOM check is a UI hint, not authorization for the main-process source write. */
export function requestSourceEditValidation(
  win: Window | null | undefined,
  request: SourceEditValidationRequest,
  options: { signal: AbortSignal; timeoutMs?: number },
): Promise<SourceEditSelection | null> {
  if (!win || options.signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let settled = false;
    const finish = (selection: SourceEditSelection | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      options.signal.removeEventListener('abort', onAbort);
      resolve(selection);
    };
    const onAbort = () => finish(null);
    const onMessage = (event: MessageEvent) => {
      if (
        !isTrustedPreviewMessageSource(event.source, win) ||
        typeof event.data !== 'object' ||
        event.data === null
      )
        return;
      const data = event.data as Record<string, unknown>;
      if (
        data['__codesign'] !== true ||
        data['type'] !== 'SOURCE_EDIT_VALIDATED' ||
        data['requestId'] !== requestId
      )
        return;
      const selection: unknown = data['sourceEdit'];
      if (selection === null) {
        finish(null);
        return;
      }
      if (
        !isSourceEditSelection(selection) ||
        selection.targetId !== request.targetId ||
        selection.sourceHash !== request.sourceHash ||
        selection.previewRevision !== request.previewRevision
      )
        return;
      finish(selection);
    };
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 3000);
    window.addEventListener('message', onMessage);
    options.signal.addEventListener('abort', onAbort, { once: true });
    try {
      win.postMessage(
        { __codesign: true, type: 'SOURCE_EDIT_VALIDATE', requestId, ...request },
        '*',
      );
    } catch {
      finish(null);
    }
  });
}

export function postSourceEditAncestorToPreviewWindow(
  win: Window | null | undefined,
  selector: string,
  revision: Pick<SourceEditSelection, 'sourceHash' | 'previewRevision'>,
  onError: (message: string) => void,
): boolean {
  if (!win) return false;
  try {
    win.postMessage(
      {
        __codesign: true,
        type: 'SOURCE_EDIT_SELECT',
        selector,
        sourceHash: revision.sourceHash,
        previewRevision: revision.previewRevision,
      },
      '*',
    );
    return true;
  } catch (error) {
    onError(
      `SOURCE_EDIT_SELECT postMessage failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
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

export function postPinSelectorToPreviewWindow(
  win: Window | null | undefined,
  selector: string,
  onError: (message: string) => void,
): boolean {
  if (!win) return false;
  try {
    win.postMessage({ __codesign: true, type: 'PIN_SELECTOR', selector }, '*');
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    onError(`PIN_SELECTOR postMessage failed: ${reason}`);
    return false;
  }
}

export function postClearPinToPreviewWindow(
  win: Window | null | undefined,
  onError: (message: string) => void,
): boolean {
  if (!win) return false;
  try {
    win.postMessage({ __codesign: true, type: 'CLEAR_PIN' }, '*');
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    onError(`CLEAR_PIN postMessage failed: ${reason}`);
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
  | 'ELEMENT_SELECTION_CLEARED'
  | 'IFRAME_ERROR'
  | 'ELEMENT_RECTS'
  | 'PREVIEW_ESCAPE'
  | 'SOURCE_EDIT_VALIDATED';

export interface PreviewMessageHandlers {
  onPreviewEscape?: () => void;
  onSelectionCleared?: () => void;
  onElementSelected: (msg: OverlayMessage) => void;
  onIframeError: (msg: IframeErrorMessage) => void;
  onElementRects: (msg: ElementRectsMessage) => void;
}

export type PreviewMessageOutcome =
  | { status: 'handled'; type: AllowedPreviewMessageType }
  | {
      status: 'rejected';
      reason: 'envelope' | 'unknown-type' | 'shape' | 'stale-source-edit';
      type?: string;
    };

export function handlePreviewMessage(
  data: unknown,
  handlers: PreviewMessageHandlers,
  expectedSourceEditRevision?: Pick<SourceEditSelection, 'sourceHash' | 'previewRevision'>,
): PreviewMessageOutcome {
  if (typeof data !== 'object' || data === null) {
    return { status: 'rejected', reason: 'envelope' };
  }
  const envelope = data as { __codesign?: unknown; type?: unknown };
  if (envelope.__codesign !== true || typeof envelope.type !== 'string') {
    return { status: 'rejected', reason: 'envelope' };
  }

  switch (envelope.type) {
    case 'SOURCE_EDIT_VALIDATED':
      // A request-scoped listener validates these; never turn them into comments/errors.
      return { status: 'handled', type: envelope.type };
    case 'PREVIEW_ESCAPE':
      handlers.onPreviewEscape?.();
      return { status: 'handled', type: envelope.type };
    case 'ELEMENT_SELECTION_CLEARED':
      handlers.onSelectionCleared?.();
      return { status: 'handled', type: envelope.type };
    case 'ELEMENT_SELECTED':
      if (isOverlayMessage(data)) {
        // WindowProxy survives document navigation. Same-frame messages are still
        // candidate hints, and the main process must independently validate edits.
        if (
          expectedSourceEditRevision &&
          ((data.sourceEditAncestors !== undefined && !data.sourceEditRevision) ||
            (data.sourceEditRevision &&
              (data.sourceEditRevision.sourceHash !== expectedSourceEditRevision.sourceHash ||
                data.sourceEditRevision.previewRevision !==
                  expectedSourceEditRevision.previewRevision)) ||
            (data.sourceEdit &&
              (data.sourceEdit.sourceHash !== expectedSourceEditRevision.sourceHash ||
                data.sourceEdit.previewRevision !== expectedSourceEditRevision.previewRevision)))
        ) {
          return { status: 'rejected', reason: 'stale-source-edit', type: envelope.type };
        }
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
    default:
      return { status: 'rejected', reason: 'unknown-type', type: envelope.type };
  }
}
