import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectLocalAssetsFromHtml,
  inlineLocalAssetsInHtml,
  rewriteHtmlLocalAssetReferences,
} from './assets';

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-assets-test-'));
  mkdirSync(join(tempDir, 'assets', 'fonts'), { recursive: true });
  writeFileSync(join(tempDir, 'assets', 'logo.svg'), '<svg><title>Logo</title></svg>');
  writeFileSync(join(tempDir, 'assets', 'fonts', 'demo.woff2'), Buffer.from([1, 2, 3]));
  writeFileSync(
    join(tempDir, 'assets', 'site.css'),
    '@font-face{src:url("./fonts/demo.woff2")} body{background:url("/assets/logo.svg")}',
  );
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('local exporter assets', () => {
  it('inlines local HTML and nested CSS assets as data URIs', async () => {
    const out = await inlineLocalAssetsInHtml(
      '<link rel="stylesheet" href="assets/site.css"><img src="assets/logo.svg">',
      { assetBasePath: tempDir, assetRootPath: tempDir },
    );

    expect(out).toContain('href="data:text/css;charset=utf-8,');
    expect(decodeURIComponent(out)).toContain('data:font/woff2;base64,AQID');
    expect(out).toContain('src="data:image/svg+xml;charset=utf-8,');
  });

  it('collects local HTML and nested CSS references for ZIP exports', async () => {
    const assets = await collectLocalAssetsFromHtml(
      '<link rel="stylesheet" href="assets/site.css"><img src="/assets/logo.svg">',
      { assetBasePath: tempDir, assetRootPath: tempDir },
    );

    expect(assets.map((asset) => asset.path)).toEqual([
      'assets/fonts/demo.woff2',
      'assets/logo.svg',
      'assets/site.css',
    ]);
  });

  it('rewrites root-relative local paths to archive-relative paths', () => {
    const out = rewriteHtmlLocalAssetReferences('<img src="/assets/logo.svg?v=1">', {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });

    expect(out).toContain('src="assets/logo.svg?v=1"');
  });
});
