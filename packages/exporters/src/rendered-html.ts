import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyRenderableSource } from '@open-codesign/runtime';
import type { LocalAssetOptions } from './assets';
import { buildInlineHtmlDocument } from './html';

export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

export interface BrowserRenderOptions extends LocalAssetOptions {
  chromePath?: string;
  waitUntil?: BrowserWaitUntil;
  renderTimeoutMs?: number;
  settleMs?: number;
  viewport?: { width: number; height: number };
  inlineLocalAssets?: boolean;
  injectTailwind?: boolean;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export async function buildExportHtmlDocument(
  artifactSource: string,
  opts: BrowserRenderOptions = {},
): Promise<string> {
  return buildInlineHtmlDocument(artifactSource, {
    ...opts,
    prettify: false,
    injectTailwind: opts.injectTailwind ?? true,
  });
}

export function shouldRenderForStaticDom(
  artifactSource: string,
  opts: LocalAssetOptions = {},
): boolean {
  const kind = classifyRenderableSource(artifactSource, opts.sourcePath);
  if (kind === 'jsx' || kind === 'tsx') return true;
  if (kind !== 'html') return false;
  return (
    artifactSource.includes('type="text/babel"') ||
    artifactSource.includes("type='text/babel'") ||
    artifactSource.includes('ReactDOM.createRoot') ||
    artifactSource.includes('React.createElement') ||
    artifactSource.includes('IOSDevice') ||
    artifactSource.includes('DesignCanvas')
  );
}

export async function renderArtifactBodyHtml(
  artifactSource: string,
  opts: BrowserRenderOptions = {},
  evaluation = 'document.body ? document.body.innerHTML : ""',
): Promise<string> {
  const { findSystemChrome } = await import('./chrome-discovery');
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = opts.chromePath ?? (await findSystemChrome());
  const userDataDir = await mkdtemp(join(tmpdir(), 'codesign-render-'));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      args: [
        '--headless=new',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport(opts.viewport ?? DEFAULT_VIEWPORT);
    await page.setContent(await buildExportHtmlDocument(artifactSource, opts), {
      waitUntil: opts.waitUntil ?? 'load',
      timeout: opts.renderTimeoutMs ?? 45_000,
    });
    await page.evaluate('document.fonts?.ready ?? Promise.resolve()');
    if (opts.settleMs && opts.settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.settleMs));
    }
    return String(await page.evaluate(evaluation));
  } finally {
    if (browser) await browser.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}
