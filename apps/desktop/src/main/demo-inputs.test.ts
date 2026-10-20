import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_INPUT_LICENSE, DEMO_INPUTS } from '@open-codesign/templates/demo-inputs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDemoInputsFromRoot } from './demo-inputs';

const resources = fileURLToPath(new URL('../../resources/demo-inputs', import.meta.url));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codesign-demo-inputs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('bundled demo input seeding', () => {
  it('declares original permissive attribution', () => {
    expect(DEMO_INPUT_LICENSE).toMatchObject({ schemaVersion: 1, license: 'MIT' });
    expect(DEMO_INPUT_LICENSE.source).toContain('Original');
    expect(DEMO_INPUT_LICENSE.attribution).toBeTruthy();
  });

  it.each([
    'daymark',
    'common-ground',
    'trailhead',
  ] as const)('copies exactly the %s allowlist into a fresh workspace', async (id) => {
    const expected = [...DEMO_INPUTS[id].files].sort();
    expect((await readdir(path.join(resources, id))).sort()).toEqual(expected);
    await seedDemoInputsFromRoot(root, id, resources);
    expect((await readdir(root)).sort()).toEqual(expected);
    for (const file of expected) {
      const content = await readFile(path.join(root, file), 'utf8');
      expect(content).toBe(await readFile(path.join(resources, id, file), 'utf8'));
      expect(content).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
      expect(file).not.toMatch(/\.(jsx|html|tsx)$/);
      if (file.endsWith('.json')) expect(JSON.parse(content).schemaVersion).toBe(1);
    }
  });

  it('does not overwrite or add files to an existing workspace', async () => {
    await writeFile(path.join(root, 'product-brief.md'), 'My own brief');
    await expect(seedDemoInputsFromRoot(root, 'daymark', resources)).rejects.toThrow(
      'fresh empty workspace',
    );
    expect(await readFile(path.join(root, 'product-brief.md'), 'utf8')).toBe('My own brief');
    expect(await readdir(root)).toEqual(['product-brief.md']);
  });

  it('reads every input before writing, surfacing missing-file failures without partial inputs', async () => {
    const source = path.join(root, 'resources');
    const workspace = path.join(root, 'workspace');
    await mkdir(path.join(source, 'daymark'), { recursive: true });
    await mkdir(workspace);
    await writeFile(path.join(source, 'daymark', 'product-brief.md'), 'Only one file');
    await expect(seedDemoInputsFromRoot(workspace, 'daymark', source)).rejects.toThrow();
    expect(await readdir(workspace)).toEqual([]);
  });

  it('rejects a bundle symlink outside the resource root', async () => {
    const source = path.join(root, 'resources');
    const workspace = path.join(root, 'workspace');
    await mkdir(source);
    await mkdir(workspace);
    await symlink(
      path.join(resources, 'daymark'),
      path.join(source, 'daymark'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(seedDemoInputsFromRoot(workspace, 'daymark', source)).rejects.toThrow('escapes');
    expect(await readdir(workspace)).toEqual([]);
  });
});
