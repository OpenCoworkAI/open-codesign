import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SourceIdentityV1 } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectResourceManifest } from './resource-manifest.js';
import { loadSkillsFromDir } from './skills/loader.js';
import { runScaffold } from './tools/scaffold.js';
import { invokeSkill, listSkillManifest, makeSkillTool } from './tools/skill.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

const templatesRoot = path.resolve(
  import.meta.dirname,
  '../../../apps/desktop/resources/templates',
);
const source: SourceIdentityV1 = {
  schemaVersion: 1,
  path: 'pages/main.htm',
  format: 'html',
  runtimeMode: 'native-html',
};
const log = { info() {}, warn() {}, error() {}, debug() {} };
const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function temp() {
  const dir = await mkdtemp(path.join(tmpdir(), 'native-resources-'));
  temporary.push(dir);
  return dir;
}
const roots = {
  skillsRoot: path.join(templatesRoot, 'skills'),
  brandRefsRoot: path.join(templatesRoot, 'brand-refs'),
};
const sheet = (name: string, body: string, aliases = '[]', providers = "['*']") =>
  `---\nschemaVersion: 1\nname: ${name}\ndescription: ${body}\naliases: ${aliases}\ntrigger:\n  providers: ${providers}\n---\n${body}\n`;

describe('native resource discovery and dispatch', () => {
  it('prioritizes native canonical methods while retaining legacy first-match aliases', async () => {
    const skillsRoot = await temp();
    await writeFile(
      path.join(skillsRoot, 'empty-states.md'),
      sheet('empty-states', 'earlier alias', '[form-layout]'),
    );
    await writeFile(
      path.join(skillsRoot, 'form-layout.md'),
      sheet('form-layout', 'canonical body'),
    );
    expect((await invokeSkill({ name: 'form-layout', roots: { skillsRoot } })).metadata?.name).toBe(
      'empty-states',
    );
    expect(
      (await invokeSkill({ name: 'form-layout', roots: { skillsRoot, source } })).metadata?.name,
    ).toBe('form-layout');
  });
  it('preserves legacy bulk reads while retaining native discovery and body path guards', async () => {
    const skillsRoot = await temp();
    await writeFile(path.join(skillsRoot, 'form-layout.md'), sheet('form-layout', 'readable body'));
    vi.mocked(lstat).mockRejectedValue(new Error('metadata unavailable'));
    try {
      expect(await loadSkillsFromDir(skillsRoot, 'builtin')).toHaveLength(1);
      await expect(loadSkillsFromDir(skillsRoot, 'builtin', source)).rejects.toThrow(
        /metadata unavailable/,
      );
      await expect(invokeSkill({ name: 'form-layout', roots: { skillsRoot } })).rejects.toThrow(
        /metadata unavailable/,
      );
    } finally {
      vi.mocked(lstat).mockReset();
    }
  });
  it('resolves only native eligible scaffold aliases without changing legacy canonical-only dispatch', async () => {
    const workspaceRoot = await temp();
    const scaffoldsRoot = await temp();
    const entry = {
      description: 'native terminal',
      path: 'terminal.html',
      license: 'MIT',
      source: 'test',
    };
    await writeFile(
      path.join(scaffoldsRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        scaffolds: {
          terminal: { ...entry, aliases: ['shell', 'iphone-16-pro-frame'] },
          'iphone-16-pro-frame': { ...entry, aliases: ['excluded-alias'] },
        },
      }),
    );
    await writeFile(path.join(scaffoldsRoot, 'terminal.html'), '<main>Static terminal</main>');
    const request = { workspaceRoot, scaffoldsRoot, destPath: source.path };
    expect((await runScaffold({ ...request, kind: 'terminal' })).ok).toBe(true);
    expect((await runScaffold({ ...request, kind: 'shell' })).ok).toBe(false);
    expect((await runScaffold({ ...request, source, kind: 'shell' })).ok).toBe(true);
    for (const kind of ['iphone-16-pro-frame', 'excluded-alias'])
      expect((await runScaffold({ ...request, source, kind })).ok).toBe(false);
  });
  it('keeps shared native dedup separate across roots and providers without cwd fallback', async () => {
    const first = await temp();
    const second = await temp();
    for (const skillsRoot of [first, second])
      await writeFile(
        path.join(skillsRoot, 'form-layout.md'),
        sheet('form-layout', skillsRoot, '[form]'),
      );
    const dedup = new Set<string>();
    for (const [skillsRoot, providerId] of [
      [first, 'one'],
      [second, 'one'],
      [first, 'two'],
    ] as const) {
      const tool = makeSkillTool({ skillsRoot, providerId, source, dedup });
      expect((await tool.execute('load', { name: 'form' })).details.status).toBe('loaded');
      expect((await tool.execute('canonical', { name: 'form-layout' })).details.status).toBe(
        'already-loaded',
      );
    }
    expect(
      (await makeSkillTool({ source, dedup }).execute('missing-root', { name: 'form-layout' }))
        .details.status,
    ).toBe('not-found');
    expect(
      (await makeSkillTool({ skillsRoot: first, dedup }).execute('legacy', { name: 'form' }))
        .details.status,
    ).toBe('loaded');
  });
  it('does not resolve excluded or provider-disabled canonical names through eligible aliases', async () => {
    const skillsRoot = await temp();
    await writeFile(
      path.join(skillsRoot, 'data-viz-recharts.md'),
      sheet('data-viz-recharts', 'excluded', '[charts]'),
    );
    await writeFile(
      path.join(skillsRoot, 'empty-states.md'),
      sheet('empty-states', 'disabled', '[]', '[other]'),
    );
    await writeFile(
      path.join(skillsRoot, 'form-layout.md'),
      sheet('form-layout', 'allowed', '[data-viz-recharts, empty-states]'),
    );
    for (const name of ['data-viz-recharts', 'charts', 'empty-states']) {
      expect(
        (await invokeSkill({ name, roots: { skillsRoot, source, providerId: 'active' } })).status,
      ).toBe('not-found');
    }
  });
  it('rejects corrupted and symlinked native overlays instead of reading legacy bodies', async () => {
    const skillsRoot = await temp();
    const outside = await temp();
    await writeFile(path.join(skillsRoot, 'craft-polish.md'), sheet('craft-polish', 'legacy'));
    await mkdir(path.join(skillsRoot, 'native-html'));
    await writeFile(path.join(skillsRoot, 'native-html/craft-polish.md'), 'not valid frontmatter');
    await expect(loadSkillsFromDir(skillsRoot, 'builtin', source)).rejects.toThrow(
      /Invalid frontmatter/,
    );
    await writeFile(
      path.join(skillsRoot, 'native-html/craft-polish.md'),
      sheet('form-layout', 'wrong canonical'),
    );
    await expect(loadSkillsFromDir(skillsRoot, 'builtin', source)).rejects.toThrow(
      /canonical name/,
    );
    await rm(path.join(skillsRoot, 'native-html'), { recursive: true });
    await writeFile(path.join(outside, 'craft-polish.md'), sheet('craft-polish', 'outside'));
    await symlink(
      outside,
      path.join(skillsRoot, 'native-html'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      invokeSkill({ name: 'craft-polish', roots: { skillsRoot, source } }),
    ).rejects.toThrow(/symbolic link/);
  });
  it('advertises exactly 11 scaffolds, 16 methods, 25 shared brands and selected overlay paths', async () => {
    const result = await collectResourceManifest({
      log,
      providerId: 'test',
      templatesRoot,
      source,
    });
    expect(result.warnings).toEqual([]);
    expect([result.scaffoldCount, result.skillCount, result.brandCount]).toEqual([11, 16, 25]);
    expect(result.sections.join('\n')).toContain('destPath: "pages/main.htm"');
    expect(result.sections.join('\n')).not.toContain('data-viz-recharts');
    const manifest = await listSkillManifest({ ...roots, source, providerId: 'test' });
    for (const name of ['craft-polish', 'design-reference-to-html', 'chart-rendering']) {
      const entry = manifest.find((item) => item.name === name);
      expect(entry?.path.replaceAll('\\', '/')).toContain(`/native-html/${name}.md`);
      const selected = await invokeSkill({ name, roots: { ...roots, source, providerId: 'test' } });
      expect(selected.body).toBe(await readFile(entry?.path ?? '', 'utf8'));
      expect(selected.body).not.toContain('"path": "App.jsx"');
      expect(selected.body).not.toContain('skill("data-viz-recharts")');
      expect(
        result.manifest.entries.find((item) => item.name === name)?.path.replaceAll('\\', '/'),
      ).toBe(`native-html/${name}.md`);
    }
    expect(
      (await collectResourceManifest({ log, providerId: 'test', templatesRoot })).skillCount,
    ).toBe(17);
  });
  it('rejects excluded canonical names, their aliases, and unknown custom resources', async () => {
    for (const name of ['data-viz-recharts', 'custom-method']) {
      expect((await invokeSkill({ name, roots: { ...roots, source } })).status).toBe('not-found');
    }
    const workspaceRoot = await temp();
    for (const kind of ['iphone-16-pro-frame', 'iphone', 'custom-scaffold']) {
      expect(
        (
          await runScaffold({
            kind,
            destPath: source.path,
            source,
            workspaceRoot,
            scaffoldsRoot: path.join(templatesRoot, 'scaffolds'),
          })
        ).ok,
      ).toBe(false);
    }
  });
  it('selects overlay metadata before provider filtering and isolates shared dedup', async () => {
    const skillsRoot = await temp();
    await mkdir(path.join(skillsRoot, 'native-html'));
    await writeFile(
      path.join(skillsRoot, 'craft-polish.md'),
      sheet('craft-polish', 'legacy body', '[polish]'),
    );
    await writeFile(
      path.join(skillsRoot, 'native-html/craft-polish.md'),
      sheet('craft-polish', 'native body', '[polish, native-polish]', '[native-provider]'),
    );
    await writeFile(
      path.join(skillsRoot, 'custom.md'),
      sheet('custom', 'custom body', '[craft-polish]'),
    );
    const dedup = new Set<string>();
    const legacy = makeSkillTool({ skillsRoot, dedup });
    expect((await legacy.execute('legacy', { name: 'polish' })).details.status).toBe('loaded');
    const native = makeSkillTool({ skillsRoot, source, providerId: 'native-provider', dedup });
    expect((await native.execute('native', { name: 'polish' })).content).toEqual([
      {
        type: 'text',
        text: await readFile(path.join(skillsRoot, 'native-html/craft-polish.md'), 'utf8'),
      },
    ]);
    expect((await native.execute('alias', { name: 'native-polish' })).details.status).toBe(
      'already-loaded',
    );
    expect(
      (
        await invokeSkill({
          name: 'craft-polish',
          roots: { skillsRoot, source, providerId: 'other' },
        })
      ).status,
    ).toBe('not-found');
    expect((await invokeSkill({ name: 'craft-polish', roots: { skillsRoot } })).body).toContain(
      'legacy body',
    );
    await rm(path.join(skillsRoot, 'native-html/craft-polish.md'));
    await expect(loadSkillsFromDir(skillsRoot, 'builtin', source)).rejects.toThrow();
    await expect(
      invokeSkill({ name: 'craft-polish', roots: { skillsRoot, source } }),
    ).rejects.toThrow();
    expect((await invokeSkill({ name: 'custom', roots: { skillsRoot } })).status).toBe('loaded');
  });
});

describe('native scaffold primary identity', () => {
  it.each([
    'htm',
    'jsx',
  ])('uses platform path identity for case-alias primary .%s', async (extension) => {
    const workspaceRoot = await temp();
    const scaffoldsRoot = path.join(templatesRoot, 'scaffolds');
    const identity = SourceIdentityV1.parse({ ...source, path: `pages/Main.${extension}` });
    const destPath = `pages/main.${extension}`;
    const result = await runScaffold({
      kind: 'terminal',
      destPath,
      source: identity,
      workspaceRoot,
      scaffoldsRoot,
    });
    const expectedPath = process.platform === 'win32' ? identity.path : 'pages/main.html';
    expect(result).toMatchObject({ ok: true, destPath: expectedPath });
    const bytes = await readFile(path.join(workspaceRoot, expectedPath), 'utf8');
    expect(bytes).toBe(
      await readFile(path.join(scaffoldsRoot, 'dev-mockups/terminal.html'), 'utf8'),
    );
    if (process.platform === 'win32') {
      await expect(readFile(path.join(workspaceRoot, 'pages/main.html'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      for (const kind of ['aurora-mesh-bg', 'design-system-starter']) {
        expect(
          (await runScaffold({ kind, destPath, source: identity, workspaceRoot, scaffoldsRoot }))
            .ok,
        ).toBe(false);
        expect(await readFile(path.join(workspaceRoot, identity.path), 'utf8')).toBe(bytes);
      }
    }
    expect(
      (
        await runScaffold({
          kind: 'terminal',
          destPath: `legacy/Main.${extension}`,
          workspaceRoot,
          scaffoldsRoot,
        })
      ).destPath,
    ).toBe('legacy/Main.html');
  });
  it.each([
    'pages/main.htm',
    'pages/main.jsx',
    'pages/main.css',
    'pages/main.md',
  ])('keeps the precise HTML primary %s', async (entryPath) => {
    const workspaceRoot = await temp();
    const result = await runScaffold({
      kind: 'terminal',
      destPath: entryPath,
      source: { ...source, path: entryPath },
      workspaceRoot,
      scaffoldsRoot: path.join(templatesRoot, 'scaffolds'),
    });
    expect(result.ok).toBe(true);
    expect(result.destPath).toBe(entryPath);
    expect(await readFile(path.join(workspaceRoot, entryPath), 'utf8')).toBe(
      await readFile(path.join(templatesRoot, 'scaffolds/dev-mockups/terminal.html'), 'utf8'),
    );
  });
  it.each([
    ['aurora-mesh-bg', 'pages/main.htm', 'pages/main.htm'],
    ['design-system-starter', 'pages/main.htm', 'pages/main.htm'],
    ['aurora-mesh-bg', 'pages/main.css', 'pages/main.jsx'],
    ['design-system-starter', 'pages/main.md', 'pages/main.jsx'],
  ])('rejects %s direct and normalization collisions', async (kind, primary, destPath) => {
    const workspaceRoot = await temp();
    await mkdir(path.join(workspaceRoot, 'pages'));
    await writeFile(path.join(workspaceRoot, primary), 'original raw source');
    const result = await runScaffold({
      kind,
      destPath,
      source: { ...source, path: primary },
      workspaceRoot,
      scaffoldsRoot: path.join(templatesRoot, 'scaffolds'),
    });
    expect(result.ok).toBe(false);
    expect(await readFile(path.join(workspaceRoot, primary), 'utf8')).toBe('original raw source');
  });
  it('preserves auxiliary normalization and legacy HTML renaming', async () => {
    const workspaceRoot = await temp();
    const scaffoldsRoot = path.join(templatesRoot, 'scaffolds');
    expect(
      (
        await runScaffold({
          kind: 'aurora-mesh-bg',
          destPath: 'styles/bg.jsx',
          workspaceRoot,
          scaffoldsRoot,
          source,
        })
      ).destPath,
    ).toBe('styles/bg.css');
    expect(
      (
        await runScaffold({
          kind: 'terminal',
          destPath: 'legacy.htm',
          workspaceRoot,
          scaffoldsRoot,
        })
      ).destPath,
    ).toBe('legacy.html');
  });
});
