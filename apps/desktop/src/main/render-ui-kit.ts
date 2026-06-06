/**
 * render-ui-kit.ts — host-side renderer for the verify_ui_kit_visual_parity
 * agent tool. Loads the decomposed ui_kits/<slug>/index.html in a hidden
 * BrowserWindow and returns a PNG screenshot as a base64 data URL.
 *
 * Mirrors the pattern from done-verify.ts (hidden BrowserWindow + offscreen
 * render). Differences: we wait longer for fonts/CSS to settle since visual
 * parity is the goal, and we use webContents.capturePage() to grab a real
 * screenshot rather than just listening for console errors.
 *
 * Returns a data URL the in-core tool can pass straight to the vision judge.
 *
 * Not unit-tested — hidden BrowserWindow capture is not viable in vitest.
 * Manual verification path: trigger a decompose run with a known artifact,
 * confirm the screenshot lands in iter-0/rendered.png-equivalent shape.
 */

import type { RenderUiKitFn } from '@open-codesign/core';
import { BrowserWindow } from './electron-runtime';

const RENDER_VIEWPORT = { width: 1440, height: 900 } as const;
const SETTLE_AFTER_LOAD_MS = 1500;
const HARD_TIMEOUT_MS = 12_000;

export function makeUiKitRenderer(): RenderUiKitFn {
  return async (indexHtml: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('renderUiKit aborted before start');

    const dataUrl = `data:text/html;base64,${Buffer.from(indexHtml, 'utf8').toString('base64')}`;

    const win = new BrowserWindow({
      show: false,
      width: RENDER_VIEWPORT.width,
      height: RENDER_VIEWPORT.height,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
      },
    });

    try {
      // Cast through unknown to satisfy Electron's WebContents event union
      const wc = win.webContents as unknown as {
        once: (event: string, listener: (...args: unknown[]) => void) => void;
        capturePage: () => Promise<{ toPNG: () => Buffer }>;
      };

      // Race: load + settle window vs hard timeout vs abort signal.
      // Centralize cleanup in `finish()` so EVERY exit path
      // (success, fail, catch, timeout, abort) drops the timeout +
      // unregisters the abort listener. Earlier this lived only in the
      // success branch, which leaked the listener on fail/catch/timeout
      // paths (review finding on PR #241).
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimeout);
          signal?.removeEventListener('abort', onAbort);
          if (err) reject(err);
          else resolve();
        };
        const onAbort = () => finish(new Error('renderUiKit aborted by signal'));
        const hardTimeout = setTimeout(
          () => finish(new Error(`renderUiKit hard timeout after ${HARD_TIMEOUT_MS}ms`)),
          HARD_TIMEOUT_MS,
        );
        signal?.addEventListener('abort', onAbort, { once: true });

        wc.once('did-finish-load', () => {
          // Give fonts + CSS animations a moment to settle for visual parity
          setTimeout(() => finish(), SETTLE_AFTER_LOAD_MS);
        });
        wc.once('did-fail-load', () => {
          finish(new Error('renderUiKit did-fail-load'));
        });

        void win.loadURL(dataUrl).catch((err: unknown) => {
          finish(err instanceof Error ? err : new Error(String(err)));
        });
      });

      const image = await wc.capturePage();
      const pngBuffer = image.toPNG();
      const base64 = pngBuffer.toString('base64');
      return {
        dataUrl: `data:image/png;base64,${base64}`,
        mediaType: 'image/png' as const,
      };
    } finally {
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        /* noop */
      }
    }
  };
}
