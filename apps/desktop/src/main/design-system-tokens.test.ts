import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOKEN_SCAN_LIMITS, scanTokenSources } from './design-system-tokens';

const tempDirs: string[] = [];

async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codesign-token-scan-'));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scanTokenSources', () => {
  it('extracts tokens from a Tailwind config, :root CSS, @theme CSS and DTCG JSON', async () => {
    const root = await makeRepo({
      'tailwind.config.js':
        "module.exports = { theme: { extend: { colors: { brand: '#ff0066' } } } };",
      'src/styles/tokens.css': ':root { --color-ink: #112233; }',
      'src/app.css': '@import "tailwindcss";\n@theme {\n  --radius-md: 0.5rem;\n}\n',
      'design/brand.tokens.json': '{"color":{"paper":{"$value":"#fafafa","$type":"color"}}}',
      'src/index.ts': 'export {};',
      'README.md': '# repo',
    });

    const scan = await scanTokenSources(root);

    expect(scan.truncated).toBe(false);
    expect(scan.skipped).toEqual([]);
    expect(
      scan.sources.map((source) => [
        source.kind,
        source.path,
        source.tokens.map((token) => `${token.name}=${token.value}`),
      ]),
    ).toEqual([
      ['dtcg-json', 'design/brand.tokens.json', ['color.paper=#fafafa']],
      ['css', 'src/app.css', ['radius-md=0.5rem']],
      ['css', 'src/styles/tokens.css', ['color-ink=#112233']],
      ['tailwind-config', 'tailwind.config.js', ['colors.brand=#ff0066']],
    ]);
  });

  it('reads both @theme and :root blocks from one CSS file', async () => {
    const root = await makeRepo({
      'app.css': '@theme {\n  --color-brand: #ff0066;\n}\n:root {\n  --radius: 0.5rem;\n}\n',
    });

    const scan = await scanTokenSources(root);

    expect(scan.sources).toHaveLength(1);
    expect(scan.sources[0]?.tokens.map((token) => token.name)).toEqual(['color-brand', 'radius']);
  });

  it('skips node_modules and the other ignored directories', async () => {
    const root = await makeRepo({
      'node_modules/pkg/tokens.css': ':root { --color-a: #111111; }',
      'dist/tokens.css': ':root { --color-b: #222222; }',
      '.git/tokens.css': ':root { --color-c: #333333; }',
      'src/tokens.css': ':root { --color-d: #444444; }',
    });

    const scan = await scanTokenSources(root);

    expect(scan.sources.map((source) => source.path)).toEqual(['src/tokens.css']);
  });

  it('enters directories down to maxDepth and no further', async () => {
    const root = await makeRepo({
      'a/b/tokens.css': ':root { --color-a: #111111; }',
      'a/b/c/tokens.css': ':root { --color-b: #222222; }',
    });

    const scan = await scanTokenSources(root, { ...DEFAULT_TOKEN_SCAN_LIMITS, maxDepth: 2 });

    expect(scan.sources.map((source) => source.path)).toEqual(['a/b/tokens.css']);
  });

  it('stops at maxFiles and reports that it did', async () => {
    const root = await makeRepo({
      'a1.txt': '',
      'a2.txt': '',
      'a3.txt': '',
      'tokens.css': ':root { --color-a: #111111; }',
    });

    const capped = await scanTokenSources(root, { ...DEFAULT_TOKEN_SCAN_LIMITS, maxFiles: 3 });
    const roomy = await scanTokenSources(root, { ...DEFAULT_TOKEN_SCAN_LIMITS, maxFiles: 4 });

    expect(capped).toEqual({ sources: [], skipped: [], truncated: true });
    expect(roomy.truncated).toBe(false);
    expect(roomy.sources.map((source) => source.path)).toEqual(['tokens.css']);
  });

  it('reports files above maxFileBytes without reading them', async () => {
    const root = await makeRepo({
      'big.css': `/* ${'x'.repeat(100)} */\n:root { --color-a: #111111; }`,
      'small.css': ':root { --color-b: #222222; }',
    });

    const scan = await scanTokenSources(root, { ...DEFAULT_TOKEN_SCAN_LIMITS, maxFileBytes: 60 });

    expect(scan.skipped).toEqual([{ path: 'big.css', reason: 'too-large' }]);
    expect(scan.sources.map((source) => source.path)).toEqual(['small.css']);
  });

  it('reports a DTCG file that is not valid JSON', async () => {
    const root = await makeRepo({ 'tokens.json': '{ not json' });

    const scan = await scanTokenSources(root);

    expect(scan.sources).toEqual([]);
    expect(scan.skipped).toEqual([{ path: 'tokens.json', reason: 'invalid-json' }]);
  });

  it('parses a Tailwind config as text and never runs it', async () => {
    const root = await makeRepo({});
    const marker = path.join(root, 'ran.txt');
    await writeFile(
      path.join(root, 'tailwind.config.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n` +
        "module.exports = { theme: { colors: { brand: '#ff0066' } } };\n",
    );

    const scan = await scanTokenSources(root);

    expect(scan.sources[0]?.tokens.map((token) => token.value)).toEqual(['#ff0066']);
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')(
    'does not follow symlinks out of the folder',
    async () => {
      const outside = await makeRepo({ 'tokens.css': ':root { --color-a: #111111; }' });
      const root = await makeRepo({});
      await symlink(outside, path.join(root, 'linked'));
      await symlink(path.join(outside, 'tokens.css'), path.join(root, 'tokens.css'));

      const scan = await scanTokenSources(root);

      expect(scan.sources).toEqual([]);
    },
  );
});
