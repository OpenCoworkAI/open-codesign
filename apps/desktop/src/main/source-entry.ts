import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import {
  type Design,
  type DesignSourceEntryV1,
  NEW_HTML_SOURCE_ENTRY,
  SourceEntryPath,
  type SourceEntryResultV1,
  SourceEntrySelectRequestV1,
  SourceIdentityV1,
  type WorkspaceMode,
} from '@open-codesign/shared';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import {
  clearDesignWorkspace,
  type Database,
  getDesign,
  updateDesignWorkspace,
} from './snapshots-db';
import {
  isMissing,
  readSourceEntryFile,
  removeSourceEntryFile,
  SourceEntryError,
  sourceEntryFile,
  writeSourceEntryFile,
} from './source-entry-store';
import { normalizeWorkspacePath } from './workspace-path';
import { runWithWorkspaceRenameQueue, withStableWorkspacePath } from './workspace-path-lock';
import { assertWorkspacePathVisible, resolveSafeWorkspaceChildPath } from './workspace-reader';

export { SourceEntryError } from './source-entry-store';

type HostValidation = () => void | Promise<void>;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function bindingKey(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizeWorkspacePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function requireDesign(db: Database, designId: string): Design {
  const design = getDesign(db, designId);
  if (!design) throw new SourceEntryError('design-missing', 'The design no longer exists.');
  return design;
}

function requireManagedWorkspace(design: Design): string {
  if (design.previewMode && design.previewMode !== 'managed-file') {
    throw new SourceEntryError('not-applicable', 'This design does not use a managed source file.');
  }
  if (!design.workspacePath)
    throw new SourceEntryError(
      'workspace-required',
      'Select a workspace before choosing its source.',
    );
  return normalizeWorkspacePath(design.workspacePath);
}

function assertBinding(entry: DesignSourceEntryV1 | null, workspacePath: string | null): void {
  if (entry && bindingKey(entry.workspacePath) !== bindingKey(workspacePath)) {
    throw new SourceEntryError(
      'binding-mismatch',
      'The source entry belongs to a different workspace binding.',
    );
  }
}

function assertExpected(
  design: Design,
  entry: DesignSourceEntryV1 | null,
  expectedWorkspacePath: string,
  expectedRevision: string | null,
): void {
  if (bindingKey(design.workspacePath) !== bindingKey(expectedWorkspacePath)) {
    throw new SourceEntryError(
      'workspace-changed',
      'The workspace changed; reload its source entry.',
    );
  }
  if ((entry?.revision ?? null) !== expectedRevision) {
    throw new SourceEntryError(
      'revision-changed',
      'The source entry changed; reload it before retrying.',
    );
  }
}

async function readSource(
  workspace: string,
  sourcePath: string,
  allowEmpty = false,
): Promise<string | null> {
  SourceEntryPath.parse(sourcePath);
  assertWorkspacePathVisible(sourcePath);
  const rootInfo = await lstat(workspace);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new SourceEntryError(
      'unsafe-path',
      'The source workspace must be an unlinked directory.',
    );
  }
  const canonicalRoot = await realpath(workspace);
  let file: string;
  try {
    file = await resolveSafeWorkspaceChildPath(workspace, sourcePath);
  } catch {
    throw new SourceEntryError(
      'unsafe-path',
      'The source path escapes the workspace or contains a link.',
    );
  }
  let info: Stats;
  try {
    info = await lstat(file);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new SourceEntryError(
      'unsafe-path',
      'The source must be an unlinked regular workspace file.',
    );
  }
  if (info.size > MAX_SOURCE_BYTES)
    throw new SourceEntryError(
      'source-too-large',
      'Source files larger than 2 MiB are not supported.',
    );
  const handle = await open(file, 'r');
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== info.dev ||
      opened.ino !== info.ino
    ) {
      throw new SourceEntryError('unsafe-path', 'The source changed while opening it.');
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(file);
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      (await realpath(workspace)) !== canonicalRoot
    ) {
      throw new SourceEntryError('source-changed', 'The source changed while reading it.');
    }
  } finally {
    await handle.close();
  }
  if (bytes.length > MAX_SOURCE_BYTES)
    throw new SourceEntryError(
      'source-too-large',
      'Source files larger than 2 MiB are not supported.',
    );
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SourceEntryError('source-encoding', 'The source must contain valid UTF-8 text.');
  }
  if (content.includes('\u0000'))
    throw new SourceEntryError('source-encoding', 'Binary source files are not supported.');
  if (!allowEmpty && !content.trim())
    throw new SourceEntryError('source-empty', 'The selected source is empty.');
  return content;
}

async function requireSource(workspace: string, sourcePath: string): Promise<string> {
  const content = await readSource(workspace, sourcePath);
  if (content === null)
    throw new SourceEntryError('source-missing', 'The selected source no longer exists.');
  return content;
}

async function legacySource(
  workspace: string,
  sourcePath: string,
): Promise<{ source: SourceIdentityV1; content: string } | null> {
  let content = await readSource(workspace, sourcePath);
  if (content === null) return null;
  const runtime = await import('@open-codesign/runtime');
  let actualPath = sourcePath;
  if (/\.html?$/i.test(sourcePath)) {
    const reference = runtime.findArtifactSourceReference(content);
    if (reference !== null) {
      const resolved = runtime.resolveArtifactSourceReferencePath(sourcePath, reference);
      if (resolved === null)
        throw new SourceEntryError('invalid-reference', 'The legacy source reference is invalid.');
      actualPath = SourceEntryPath.parse(resolved);
      content = await requireSource(workspace, actualPath);
    } else if (/<!--\s*artifact source lives in\b/i.test(content)) {
      throw new SourceEntryError('invalid-reference', 'The legacy source reference is invalid.');
    }
  }
  const format = runtime.classifyRenderableSource(content, actualPath);
  if (format === 'unknown')
    throw new SourceEntryError('unsupported-source', 'The selected source format is unsupported.');
  return {
    source: { schemaVersion: 1, path: actualPath, format, runtimeMode: 'legacy-auto' },
    content,
  };
}

async function resolveEntry(
  design: Design,
  entry: DesignSourceEntryV1 | null,
): Promise<SourceEntryResultV1> {
  const base = {
    schemaVersion: 1 as const,
    designId: design.id,
    workspacePath: design.workspacePath,
    revision: entry?.revision ?? null,
  };
  if (design.previewMode && design.previewMode !== 'managed-file') {
    return {
      ...base,
      status: 'not-applicable',
      reason: design.previewMode,
      message: 'This preview does not use a managed source file.',
    };
  }
  assertBinding(entry, design.workspacePath);
  if (entry?.phase === 'invalidated')
    throw new SourceEntryError(
      'invalidated',
      'The workspace binding changed; explicitly select its primary source.',
    );
  const workspacePath = requireManagedWorkspace(design);
  if (entry) {
    const content = await readSource(workspacePath, entry.source.path, entry.phase === 'planned');
    if (entry.phase === 'planned')
      return {
        ...base,
        workspacePath,
        revision: entry.revision,
        status: 'planned',
        source: entry.source,
        content,
      };
    if (content === null)
      throw new SourceEntryError('source-missing', 'The confirmed source no longer exists.');
    return {
      ...base,
      workspacePath,
      status: 'ready',
      source: entry.source,
      content,
      origin: 'declared',
    };
  }
  const candidates = new Map<string, { source: SourceIdentityV1; content: string }>();
  for (const file of ['App.jsx', 'App.tsx', 'index.html']) {
    const candidate = await legacySource(workspacePath, file);
    if (candidate) {
      const key =
        process.platform === 'win32' ? candidate.source.path.toLowerCase() : candidate.source.path;
      candidates.set(key, candidate);
    }
  }
  const only = [...candidates.values()][0];
  if (candidates.size === 1 && only)
    return { ...base, workspacePath, status: 'ready', ...only, origin: 'legacy' };
  return {
    ...base,
    workspacePath,
    status: 'needs-selection',
    candidates: [...candidates.values()].map((candidate) => candidate.source),
    reason: candidates.size === 0 ? 'no-candidates' : 'ambiguous-candidates',
    message:
      candidates.size === 0
        ? 'Choose a source file after creating it.'
        : 'Choose which file is the primary design source.',
  };
}

export async function withSourceEntry<T>(
  db: Database,
  designId: string,
  operation: (entry: SourceEntryResultV1) => Promise<T> | T,
): Promise<T> {
  return withStableWorkspacePath(designId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, designId), async () => {
      let design: Design | null = null;
      let entry: DesignSourceEntryV1 | null = null;
      let resolved: SourceEntryResultV1;
      try {
        design = requireDesign(db, designId);
        if (!design.previewMode || design.previewMode === 'managed-file')
          entry = await readSourceEntryFile(db, designId);
        resolved = await resolveEntry(design, entry);
      } catch (error) {
        resolved = {
          schemaVersion: 1,
          designId,
          workspacePath: design?.workspacePath ?? null,
          revision: entry?.revision ?? null,
          status: 'invalid',
          reason: error instanceof SourceEntryError ? error.reason : 'workspace-error',
          message:
            error instanceof SourceEntryError
              ? error.message
              : 'The workspace source could not be read safely.',
        };
      }
      return operation(resolved);
    }),
  );
}

export async function getSourceEntry(db: Database, designId: string): Promise<SourceEntryResultV1> {
  return withSourceEntry(db, designId, (entry) => entry);
}

export interface SourceWorkspaceTuple {
  workspacePath: string;
  revision: string | null;
  source: SourceIdentityV1;
}
export interface AutoManagedSourceRename {
  designId: string;
  before: SourceWorkspaceTuple;
  after: SourceWorkspaceTuple;
}
const autoManagedRenameListeners = new Set<(event: AutoManagedSourceRename) => void>();
export function onAutoManagedSourceRename(
  listener: (event: AutoManagedSourceRename) => void,
): () => void {
  autoManagedRenameListeners.add(listener);
  return () => {
    autoManagedRenameListeners.delete(listener);
  };
}
export function notifyAutoManagedSourceRename(event: AutoManagedSourceRename): void {
  for (const listener of autoManagedRenameListeners) {
    try {
      listener(event);
    } catch {
      /* A notification cannot undo a committed directory rename. */
    }
  }
}

export async function initializeSourceEntry(
  db: Database,
  designId: string,
): Promise<DesignSourceEntryV1 & { phase: 'planned' }> {
  return withStableWorkspacePath(designId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, designId), async () => {
      const design = requireDesign(db, designId);
      const workspacePath = requireManagedWorkspace(design);
      const previous = await readSourceEntryFile(db, designId);
      if (previous)
        throw new SourceEntryError(
          'entry-exists',
          'This design already has a source-entry declaration.',
        );
      const entry = {
        schemaVersion: 1 as const,
        designId,
        workspacePath,
        revision: randomUUID(),
        phase: 'planned' as const,
        source: {
          schemaVersion: 1 as const,
          path: NEW_HTML_SOURCE_ENTRY,
          format: 'html' as const,
          runtimeMode: 'native-html' as const,
        },
      };
      await readSource(workspacePath, entry.source.path, true);
      await writeSourceEntryFile(db, designId, entry, previous, async () => {
        assertExpected(requireDesign(db, designId), previous, workspacePath, null);
      });
      return entry;
    }),
  );
}

export interface ConfirmSourceEntryInput {
  schemaVersion: 1;
  designId: string;
  expectedWorkspacePath: string;
  expectedRevision: string | null;
  source: SourceIdentityV1;
  expectedContent: string;
}

async function persistConfirmed(
  db: Database,
  design: Design,
  previous: DesignSourceEntryV1 | null,
  source: SourceIdentityV1,
  expectedContent: string,
  validate: HostValidation,
  beforeCommit?: () => void,
): Promise<DesignSourceEntryV1> {
  const workspacePath = requireManagedWorkspace(design);
  const destination = await resolveSafeWorkspaceChildPath(workspacePath, source.path);
  return withWorkspaceFileWriter(destination, async () => {
    const check = async () => {
      const current = requireDesign(db, design.id);
      assertExpected(current, previous, workspacePath, previous?.revision ?? null);
      requireManagedWorkspace(current);
      await validate();
      if ((await requireSource(workspacePath, source.path)) !== expectedContent)
        throw new SourceEntryError('source-changed', 'The source changed after it was accepted.');
    };
    await check();
    const entry: DesignSourceEntryV1 = {
      schemaVersion: 1,
      designId: design.id,
      workspacePath,
      revision: randomUUID(),
      phase: 'confirmed',
      source,
    };
    await writeSourceEntryFile(db, design.id, entry, previous, check, beforeCommit);
    return entry;
  });
}

export async function selectSourceEntry(
  db: Database,
  input: SourceEntrySelectRequestV1,
  validate: HostValidation,
): Promise<DesignSourceEntryV1> {
  SourceEntrySelectRequestV1.parse(input);
  return withStableWorkspacePath(input.designId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, input.designId), async () => {
      const design = requireDesign(db, input.designId);
      const previous = await readSourceEntryFile(db, input.designId);
      assertExpected(design, previous, input.expectedWorkspacePath, input.expectedRevision);
      const workspace = requireManagedWorkspace(design);
      await validate();
      let selected: { source: SourceIdentityV1; content: string };
      if (previous?.source?.runtimeMode === 'native-html' && /\.html?$/i.test(input.path)) {
        selected = {
          source: {
            schemaVersion: 1,
            path: input.path,
            format: 'html',
            runtimeMode: 'native-html',
          },
          content: await requireSource(workspace, input.path),
        };
      } else {
        const candidate = await legacySource(workspace, input.path);
        if (!candidate)
          throw new SourceEntryError('source-missing', 'The selected source does not exist.');
        selected = candidate;
      }
      return persistConfirmed(db, design, previous, selected.source, selected.content, validate);
    }),
  );
}

/** Binding callbacks run under the stable lease and metadata writer, before queued renames. */
export interface SourceConfirmationLifecycle {
  beforeCommit?: () => void;
  onCommitted?: (entry: DesignSourceEntryV1) => void;
  expectedBinding?: () => Pick<
    ConfirmSourceEntryInput,
    'expectedWorkspacePath' | 'expectedRevision'
  >;
}

export async function confirmSourceEntry(
  db: Database,
  input: ConfirmSourceEntryInput,
  validate: HostValidation,
  lifecycle: SourceConfirmationLifecycle = {},
): Promise<DesignSourceEntryV1> {
  if (input.schemaVersion !== 1)
    throw new SourceEntryError('invalid-input', 'Unsupported source confirmation schema.');
  SourceIdentityV1.parse(input.source);
  return withStableWorkspacePath(input.designId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, input.designId), async () => {
      const design = requireDesign(db, input.designId);
      const previous = await readSourceEntryFile(db, input.designId);
      const expected = lifecycle.expectedBinding?.() ?? input;
      assertExpected(design, previous, expected.expectedWorkspacePath, expected.expectedRevision);
      assertBinding(previous, design.workspacePath);
      if (previous?.phase === 'invalidated')
        throw new SourceEntryError(
          'invalidated',
          'Explicitly select a source after rebinding the workspace.',
        );
      if (
        previous?.source.runtimeMode === 'native-html' &&
        input.source.runtimeMode !== 'native-html'
      )
        throw new SourceEntryError(
          'runtime-mismatch',
          'Native generation cannot silently switch to a legacy runtime.',
        );
      const confirmed = await persistConfirmed(
        db,
        design,
        previous,
        input.source,
        input.expectedContent,
        validate,
        lifecycle.beforeCommit,
      );
      lifecycle.onCommitted?.(confirmed);
      return confirmed;
    }),
  );
}

/** The caller owns the exclusive workspace-rename queue, never a stable lease. */
export async function changeSourceEntryWorkspace(
  db: Database,
  designId: string,
  workspacePath: string | null,
  preserveSource: boolean,
  moveFiles: () => Promise<void>,
  workspaceMode?: WorkspaceMode,
  onPreservedRename?: (event: AutoManagedSourceRename) => void,
): Promise<Design> {
  return withWorkspaceFileWriter(sourceEntryFile(db, designId), async () => {
    const before = requireDesign(db, designId);
    const previous = await readSourceEntryFile(db, designId);
    assertBinding(previous, before.workspacePath);
    const nextPath = workspacePath === null ? null : normalizeWorkspacePath(workspacePath);
    if (bindingKey(before.workspacePath) === bindingKey(nextPath)) return before;
    let preserved: {
      source: SourceIdentityV1;
      phase: 'planned' | 'confirmed';
      content: string | null;
    } | null = null;
    if (preserveSource && before.workspacePath && previous?.phase !== 'invalidated') {
      const resolved = await resolveEntry(before, previous);
      if (resolved.status === 'planned' || resolved.status === 'ready')
        preserved = {
          source: resolved.source,
          phase: resolved.status === 'planned' ? 'planned' : 'confirmed',
          content: resolved.content,
        };
    }
    const moveAndPersist = async () => {
      await moveFiles();
      if (preserved && nextPath) {
        const copied = await readSource(
          nextPath,
          preserved.source.path,
          preserved.phase === 'planned',
        );
        if (copied !== preserved.content)
          throw new SourceEntryError(
            'source-changed',
            'The moved source does not match the original source.',
          );
      }
      const updateBinding = () => {
        const updated =
          nextPath === null
            ? clearDesignWorkspace(db, designId)
            : updateDesignWorkspace(db, designId, nextPath, workspaceMode);
        if (!updated) throw new SourceEntryError('design-missing', 'The design no longer exists.');
        return updated;
      };
      // Initial imports stay read-only legacy; rebinding always leaves a fresh revision.
      if (before.workspacePath === null && previous === null && nextPath !== null)
        return updateBinding();
      const entry: DesignSourceEntryV1 =
        preserved && nextPath
          ? {
              schemaVersion: 1,
              designId,
              workspacePath: nextPath,
              revision: randomUUID(),
              phase: preserved.phase,
              source: preserved.source,
            }
          : {
              schemaVersion: 1,
              designId,
              workspacePath: nextPath,
              revision: randomUUID(),
              phase: 'invalidated',
              source: previous?.source ?? null,
            };
      // Persist first: a failed DB update then leaves a detectable binding mismatch,
      // never an undeclared new workspace that could silently resolve unrelated files.
      await writeSourceEntryFile(db, designId, entry, previous, async () => {
        if (
          bindingKey(requireDesign(db, designId).workspacePath) !== bindingKey(before.workspacePath)
        )
          throw new SourceEntryError(
            'workspace-changed',
            'The workspace changed before saving its source entry.',
          );
        if (
          preserved &&
          nextPath &&
          (await readSource(nextPath, preserved.source.path, preserved.phase === 'planned')) !==
            preserved.content
        )
          throw new SourceEntryError('source-changed', 'The moved source changed before saving.');
      });
      const updated = updateBinding();
      if (preserved && before.workspacePath && nextPath) {
        try {
          onPreservedRename?.({
            designId,
            before: {
              workspacePath: before.workspacePath,
              revision: previous?.revision ?? null,
              source: preserved.source,
            },
            after: { workspacePath: nextPath, revision: entry.revision, source: preserved.source },
          });
        } catch {
          /* The binding has committed; notification failure is not rollback. */
        }
      }
      return updated;
    };
    if (preserved && before.workspacePath) {
      const expected = preserved;
      const workspace = before.workspacePath;
      const file = await resolveSafeWorkspaceChildPath(workspace, expected.source.path);
      return withWorkspaceFileWriter(file, async () => {
        if (
          (await readSource(workspace, expected.source.path, expected.phase === 'planned')) !==
          expected.content
        )
          throw new SourceEntryError(
            'source-changed',
            'The source changed before moving its workspace.',
          );
        return moveAndPersist();
      });
    }
    return moveAndPersist();
  });
}

export async function duplicateWithSourceEntry(
  db: Database,
  sourceId: string,
  targetId: string,
  copy: () => Promise<Design>,
): Promise<Design> {
  return withStableWorkspacePath(sourceId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, sourceId), async () => {
      const original = requireDesign(db, sourceId);
      const previous = await readSourceEntryFile(db, sourceId);
      assertBinding(previous, original.workspacePath);
      const resolved =
        previous?.phase === 'invalidated' ? null : await resolveEntry(original, previous);
      const copyAndPersist = async () => {
        const target = await copy();
        return withStableWorkspacePath(targetId, () =>
          withWorkspaceFileWriter(sourceEntryFile(db, targetId), async () => {
            const workspacePath = requireManagedWorkspace(target);
            if (await readSourceEntryFile(db, targetId))
              throw new SourceEntryError(
                'entry-exists',
                'The duplicated design already has a source entry.',
              );
            let entry: DesignSourceEntryV1 | null = null;
            if (previous?.phase === 'invalidated')
              entry = { ...previous, designId: targetId, workspacePath, revision: randomUUID() };
            if (resolved?.status === 'ready' || resolved?.status === 'planned') {
              const content = await readSource(
                workspacePath,
                resolved.source.path,
                resolved.status === 'planned',
              );
              const latest = await readSource(
                requireManagedWorkspace(original),
                resolved.source.path,
                resolved.status === 'planned',
              );
              if (content !== resolved.content || latest !== content)
                throw new SourceEntryError(
                  'source-changed',
                  'The source changed while duplicating the design.',
                );
              entry = {
                schemaVersion: 1,
                designId: targetId,
                workspacePath,
                revision: randomUUID(),
                phase: resolved.status === 'planned' ? 'planned' : 'confirmed',
                source: resolved.source,
              };
            }
            if (entry)
              await writeSourceEntryFile(db, targetId, entry, null, async () => {
                assertExpected(
                  requireDesign(db, sourceId),
                  previous,
                  requireManagedWorkspace(original),
                  previous?.revision ?? null,
                );
                if (resolved?.status === 'ready' || resolved?.status === 'planned') {
                  const allowEmpty = resolved.status === 'planned';
                  if (
                    (await readSource(workspacePath, resolved.source.path, allowEmpty)) !==
                      resolved.content ||
                    (await readSource(
                      requireManagedWorkspace(original),
                      resolved.source.path,
                      allowEmpty,
                    )) !== resolved.content
                  )
                    throw new SourceEntryError(
                      'source-changed',
                      'The duplicated source changed before saving.',
                    );
                }
                if (
                  bindingKey(requireDesign(db, targetId).workspacePath) !==
                  bindingKey(workspacePath)
                )
                  throw new SourceEntryError(
                    'workspace-changed',
                    'The duplicated workspace changed.',
                  );
              });
            return target;
          }),
        );
      };
      if (resolved?.status === 'ready' || resolved?.status === 'planned') {
        const workspace = requireManagedWorkspace(original);
        const file = await resolveSafeWorkspaceChildPath(workspace, resolved.source.path);
        return withWorkspaceFileWriter(file, async () => {
          if (
            (await readSource(workspace, resolved.source.path, resolved.status === 'planned')) !==
            resolved.content
          )
            throw new SourceEntryError(
              'source-changed',
              'The source changed before duplicating it.',
            );
          return copyAndPersist();
        });
      }
      return copyAndPersist();
    }),
  );
}

export async function removeSourceEntryForRollback(db: Database, designId: string): Promise<void> {
  await runWithWorkspaceRenameQueue(designId, () =>
    withWorkspaceFileWriter(sourceEntryFile(db, designId), () =>
      removeSourceEntryFile(db, designId),
    ),
  );
}
