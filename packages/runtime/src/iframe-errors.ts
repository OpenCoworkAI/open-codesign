/**
 * Iframe runtime error reporting — types + guard.
 *
 * The overlay script (see `overlay.ts`) installs `window.onerror` and
 * `unhandledrejection` listeners inside the sandbox iframe and forwards
 * captured errors to the parent via postMessage. This file is the contract
 * the parent uses to type-narrow incoming messages.
 *
 * Hard rule (PRINCIPLES §10): never swallow these errors. The parent must
 * surface every `IFRAME_ERROR` message in the UI (e.g. CanvasErrorBar).
 */

export interface IframeErrorMessage {
  __codesign: true;
  type: 'IFRAME_ERROR';
  kind: 'error' | 'unhandledrejection';
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  timestamp: number;
}

export function isIframeErrorMessage(data: unknown): data is IframeErrorMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { __codesign?: boolean }).__codesign === true &&
    (data as { type?: string }).type === 'IFRAME_ERROR' &&
    typeof (data as { message?: unknown }).message === 'string'
  );
}
