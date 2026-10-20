import { lstat, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodesignError } from '@open-codesign/shared';
import { DEMO_INPUTS, type DemoInputId } from '@open-codesign/templates/demo-inputs';
import { resolveBundledTemplatesDir } from './ensure-user-templates';

export async function seedDemoInputs(
  workspacePath: string,
  bundleId: DemoInputId,
  resourcesPath: string | undefined = process.resourcesPath,
): Promise<void> {
  const templates = resolveBundledTemplatesDir(resourcesPath);
  if (!templates) throw new CodesignError('Bundled demo inputs are unavailable', 'IPC_NOT_FOUND');
  const sourceRoot = path.join(path.dirname(templates), 'demo-inputs');
  await seedDemoInputsFromRoot(workspacePath, bundleId, sourceRoot);
}

/** Only called for a just-allocated workspace, before it is bound or exposed to the renderer. */
export async function seedDemoInputsFromRoot(
  workspacePath: string,
  bundleId: DemoInputId,
  sourceRoot: string,
): Promise<void> {
  const bundle = DEMO_INPUTS[bundleId];
  if (!bundle || !Object.hasOwn(DEMO_INPUTS, bundleId)) {
    throw new CodesignError('Unknown demo input bundle', 'IPC_BAD_INPUT');
  }
  if ((await lstat(workspacePath)).isSymbolicLink() || (await readdir(workspacePath)).length > 0) {
    throw new CodesignError('Demo inputs require a fresh empty workspace', 'IPC_CONFLICT');
  }
  const root = await realpath(sourceRoot);
  const source = path.join(root, bundleId);
  if ((await lstat(source)).isSymbolicLink() || (await realpath(source)) !== source) {
    throw new CodesignError('Demo bundle escapes its resource directory', 'IPC_BAD_INPUT');
  }
  // Read and validate every source before the first write; a broken pack cannot half-seed.
  const inputs = await Promise.all(
    bundle.files.map(async (file) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(file)) {
        throw new CodesignError('Invalid demo input filename', 'IPC_BAD_INPUT');
      }
      const input = path.join(source, file);
      const info = await lstat(input);
      if (!info.isFile() || info.isSymbolicLink() || (await realpath(input)) !== input) {
        throw new CodesignError('Demo input must be a regular bundled file', 'IPC_BAD_INPUT');
      }
      return { file, content: await readFile(input) };
    }),
  );
  for (const { file, content } of inputs) {
    await writeFile(path.join(workspacePath, file), content, { flag: 'wx' });
  }
}
