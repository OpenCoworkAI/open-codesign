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

  it('preserves CSS quoting inside JSX style strings', async () => {
    const source =
      'function App() { return <div style={{backgroundImage:"url(assets/logo.svg)"}} />; }';
    const out = await inlineLocalAssetsInHtml(source, {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });
    expect(out).toContain('backgroundImage:"url(data:image/svg+xml;charset=utf-8,');
    expect(out).not.toContain('url("');
    expect(out).toContain(')"}}');
    const archive = rewriteHtmlLocalAssetReferences(source.replace('url(assets/', 'url(/assets/'), {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });
    expect(archive).toBe(source);
  });

  it.each([
    '"',
    "'",
  ])('encodes archive path segments without adding quotes inside %s JSX strings', (quote) => {
    const asset = 'assets/brand%20images/it%27s%20%22local%22%20%28draft%29%25%23%3F.svg';
    const suffix = '?version=2&name=some%20name#icon';
    const source = `function App() { return <div style={{backgroundImage:${quote}url(../${asset}${suffix})${quote}}} />; }`;
    const out = rewriteHtmlLocalAssetReferences(source, {
      assetBasePath: join(tempDir, 'screens'),
      assetRootPath: tempDir,
    });

    expect(out).toBe(source.replace(`../${asset}`, asset));
    expect(rewriteHtmlLocalAssetReferences(out, { assetRootPath: tempDir })).toBe(out);
  });

  it('encodes archive attribute and srcset URLs while preserving descriptors and suffixes', () => {
    const asset = 'assets/brand%20images/it%27s%20%28local%29.svg';
    const source = `<img src="/${asset}?v=1#icon" srcset="/${asset} 1x, /${asset}?v=2 2x">`;

    expect(rewriteHtmlLocalAssetReferences(source, { assetRootPath: tempDir })).toBe(
      `<img src="${asset}?v=1#icon" srcset="${asset} 1x, ${asset}?v=2 2x">`,
    );
  });

  it('escapes text assets for single-quoted attributes and unquoted CSS URLs', async () => {
    writeFileSync(join(tempDir, 'assets', 'quoted.svg'), "<svg><title>It's (local)</title></svg>");
    const out = await inlineLocalAssetsInHtml("<img src='assets/quoted.svg'>", {
      assetBasePath: tempDir,
      assetRootPath: tempDir,
    });
    expect(out).toContain('It%27s%20%28local%29');
    expect(out.match(/'/g)).toHaveLength(2);
  });
});
