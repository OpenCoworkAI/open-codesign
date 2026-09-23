import { lstat, readFile, realpath } from 'node:fs/promises';
import {
  SourceEditApplyRequestV1,
  type SourceEditApplyResultV1,
  SourceEditInspectRequestV1,
  type SourceEditInspectResultV1,
  type SourceEditRejectedV1,
} from '@open-codesign/shared';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import type { BrowserWindow } from 'electron';
import { ipcMain } from './electron-runtime';
import { getLogger } from './logger';
import { type Database, getDesign, normalizeDesignFilePath } from './snapshots-db';
import { commitSourceEdit, SourceEditCommitError } from './source-edit-atomic';
import { withStableWorkspacePath } from './workspace-path-lock';
import { assertWorkspacePathVisible, resolveSafeWorkspaceChildPath } from './workspace-reader';

const logger = getLogger('source-edits-ipc');
type BusyCheck = (designId: string, workspacePath: string) => boolean | Promise<boolean>;
let busyCheck: BusyCheck | undefined;

/** Connect the existing generation registry, never renderer-supplied busy state. */
export function registerSourceEditBusyCheck(check: BusyCheck): () => void {
  busyCheck = check;
  return () => {
    if (busyCheck === check) busyCheck = undefined;
  };
}

function rejected(reason: string, message: string): SourceEditRejectedV1 {
  return { schemaVersion: 1, status: 'rejected', reason, message };
}
function failure(error: unknown): SourceEditRejectedV1 {
  if (error instanceof SourceEditCommitError) return rejected(error.reason, error.message);
  return rejected(
    'workspace-error',
    'The workspace source could not be edited. Reload the file and try again.',
  );
}
function assertSenderAlive(event: unknown): void {
  const sender = (event as { sender?: { isDestroyed?: () => boolean } } | null)?.sender;
  if (sender?.isDestroyed?.())
    throw new SourceEditCommitError('cancelled', 'The editing window was closed.');
}
async function assertIdle(designId: string, workspacePath: string): Promise<void> {
  if (!busyCheck)
    throw new SourceEditCommitError(
      'unavailable',
      'The generation state is unavailable; source editing is disabled.',
    );
  if (await busyCheck(designId, workspacePath))
    throw new SourceEditCommitError('busy', 'Wait for generation to finish before editing source.');
}
function sourcePath(raw: string): string {
  const normalized = normalizeDesignFilePath(raw);
  assertWorkspacePathVisible(normalized);
  if (!/\.(jsx|tsx)$/i.test(normalized))
    throw new SourceEditCommitError(
      'unsupported-source',
      'Only workspace JSX and TSX source files support local edits.',
    );
  return normalized;
}

export function registerSourceEditsIpc(db: Database, getWin: () => BrowserWindow | null): void {
  async function inSource<T>(
    input: { designId: string; path: string },
    event: unknown,
    operation: (context: {
      path: string;
      destination: string;
      content: string;
      validate: () => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    const normalized = sourcePath(input.path);
    return withStableWorkspacePath(input.designId, async () => {
      const design = getDesign(db, input.designId);
      if (!design?.workspacePath)
        throw new SourceEditCommitError(
          'workspace-required',
          'A real bound workspace is required for source edits.',
        );
      const root = design.workspacePath;
      const canonicalRoot = await realpath(root);
      const destination = await resolveSafeWorkspaceChildPath(root, normalized);
      return withWorkspaceFileWriter(destination, async () => {
        const validate = async () => {
          assertSenderAlive(event);
          const latest = getDesign(db, input.designId);
          if (
            latest?.workspacePath !== root ||
            (await realpath(root)) !== canonicalRoot ||
            (await resolveSafeWorkspaceChildPath(root, normalized)) !== destination
          ) {
            throw new SourceEditCommitError(
              'workspace-changed',
              'The workspace changed; select the current source again.',
            );
          }
          const entry = await lstat(destination);
          if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
            throw new SourceEditCommitError(
              'unsafe-path',
              'Source edits require an unlinked regular workspace file.',
            );
          }
          if (entry.size > 2 * 1024 * 1024)
            throw new SourceEditCommitError(
              'unsupported-source',
              'Source files larger than 2 MiB are not supported.',
            );
          await assertIdle(input.designId, canonicalRoot);
          assertSenderAlive(event);
        };
        await validate();
        const bytes = await readFile(destination);
        if (bytes.length > 2 * 1024 * 1024)
          throw new SourceEditCommitError(
            'unsupported-source',
            'Source files larger than 2 MiB are not supported.',
          );
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (content.includes('\u0000'))
          throw new SourceEditCommitError(
            'unsupported-source',
            'Binary source files are not supported.',
          );
        return operation({ path: normalized, destination, content, validate });
      });
    });
  }

  ipcMain.handle(
    'codesign:source-edits:v1:inspect',
    async (event: unknown, raw: unknown): Promise<SourceEditInspectResultV1> => {
      const input = SourceEditInspectRequestV1.safeParse(raw);
      if (!input.success) return rejected('invalid-input', 'Invalid source inspection request.');
      try {
        return await inSource(input.data, event, async (source) => {
          if (source.content !== input.data.expectedContent)
            return rejected('stale-source', 'The preview source changed; reload before editing.');
          const { analyzeSourceEdit } = await import('./source-edit-engine');
          await source.validate();
          return analyzeSourceEdit({
            path: source.path,
            source: source.content,
            selectionMode: input.data.selectionMode,
          });
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    'codesign:source-edits:v1:apply',
    async (event: unknown, raw: unknown): Promise<SourceEditApplyResultV1> => {
      const input = SourceEditApplyRequestV1.safeParse(raw);
      if (!input.success) return rejected('invalid-input', 'Invalid source edit request.');
      try {
        return await inSource(input.data, event, async (source) => {
          const { planSourceEdit } = await import('./source-edit-engine');
          const plan = planSourceEdit({ ...input.data, path: source.path, source: source.content });
          if (plan.status === 'rejected') return plan;
          await commitSourceEdit({
            destination: source.destination,
            expectedContent: source.content,
            content: plan.content,
            validate: source.validate,
          });
          // The filesystem is authoritative. Notification failure cannot un-save a
          // committed edit, and must never trigger a rollback over an external edit.
          const warnings: string[] = [];
          try {
            const win = getWin();
            if (win && !win.isDestroyed())
              win.webContents.send('codesign:files:v1:changed', {
                schemaVersion: 1,
                designId: input.data.designId,
              });
          } catch (error) {
            warnings.push(
              'The source was saved, but automatic preview refresh failed. Reload the preview.',
            );
            logger.warn('source-edit.refresh.failed', {
              designId: input.data.designId,
              error: String(error),
            });
          }
          return {
            ...plan,
            previewRevision: input.data.previewRevision,
            ...(warnings.length ? { warnings } : {}),
          };
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
