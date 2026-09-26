import type { DoneRuntimeVerifier } from '@open-codesign/core';
import {
  CodesignError,
  ERROR_CODES,
  type SourceEntryResultV1,
  type SourceIdentityV1,
} from '@open-codesign/shared';
import type { InFlightGeneration } from './generation-ipc';
import { acquireInFlightWorkspaceGeneration } from './generation-ipc';
import type { Database } from './snapshots-db';
import {
  confirmSourceEntry,
  onAutoManagedSourceRename,
  SourceEntryError,
  withSourceEntry,
} from './source-entry';
import { normalizeWorkspacePath } from './workspace-path';

function key(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function sameSource(a: SourceIdentityV1, b: SourceIdentityV1): boolean {
  return (
    a.schemaVersion === b.schemaVersion &&
    a.path === b.path &&
    a.format === b.format &&
    a.runtimeMode === b.runtimeMode
  );
}
function usable(
  entry: SourceEntryResultV1,
): asserts entry is SourceEntryResultV1 & { workspacePath: string } {
  if (entry.status === 'invalid' || entry.status === 'needs-selection')
    throw new SourceEntryError(entry.reason, `Cannot generate from this source: ${entry.message}`);
  if (!entry.workspacePath)
    throw new SourceEntryError('workspace-required', 'Generation requires a workspace.');
}

export async function createGenerationSource(options: {
  db: Database;
  designId: string;
  generationId: string;
  signal: AbortSignal;
  inFlightByDesign: ReadonlyMap<string, InFlightGeneration>;
  inFlightByWorkspace: Map<string, InFlightGeneration>;
}) {
  const { db, designId, generationId, signal, inFlightByDesign, inFlightByWorkspace } = options;
  return withSourceEntry(db, designId, (entry) => {
    usable(entry);
    signal.throwIfAborted();
    let expectedWorkspacePath = entry.workspacePath;
    let expectedRevision = entry.revision;
    const source =
      entry.status === 'planned' || entry.status === 'ready'
        ? Object.freeze({ ...entry.source })
        : undefined;
    const initialContent =
      entry.status === 'planned' || entry.status === 'ready' ? entry.content : null;
    let workspaceKey = key(expectedWorkspacePath);
    const releaseInitial = acquireInFlightWorkspaceGeneration(
      generationId,
      workspaceKey,
      inFlightByWorkspace,
    );
    let disposed = false;
    let mutationSeq = 0;
    const mutations = new Set<string>();
    let verified: { content: string; mutationSeq: number } | undefined;
    let acceptedRawSource: string | undefined;
    let committed = false;
    const assertOwned = () => {
      signal.throwIfAborted();
      if (
        disposed ||
        inFlightByDesign.get(designId)?.generationId !== generationId ||
        inFlightByWorkspace.get(workspaceKey)?.generationId !== generationId
      ) {
        throw new SourceEntryError(
          'run-changed',
          'This generation no longer owns the design and workspace.',
        );
      }
    };
    const validateEntry = (current: SourceEntryResultV1) => {
      assertOwned();
      usable(current);
      if (
        key(current.workspacePath) !== key(expectedWorkspacePath) ||
        current.revision !== expectedRevision ||
        (source
          ? !('source' in current) || !current.source || !sameSource(source, current.source)
          : current.status !== 'not-applicable')
      ) {
        throw new SourceEntryError('source-changed', 'The generation source binding changed.');
      }
    };
    const withWorkspace = <T>(
      operation: (workspaceRoot: string, current: SourceEntryResultV1) => Promise<T>,
    ): Promise<T> =>
      withSourceEntry(db, designId, async (current) => {
        validateEntry(current);
        return operation(expectedWorkspacePath, current);
      });
    const unsubscribe = onAutoManagedSourceRename((event) => {
      if (event.designId !== designId || !source || signal.aborted || disposed) return;
      assertOwned();
      if (
        key(event.before.workspacePath) !== key(expectedWorkspacePath) ||
        event.before.revision !== expectedRevision ||
        !sameSource(event.before.source, source) ||
        !sameSource(event.after.source, source)
      )
        return;
      const nextKey = key(event.after.workspacePath);
      const owner = inFlightByWorkspace.get(workspaceKey);
      if (!owner || (nextKey !== workspaceKey && inFlightByWorkspace.has(nextKey))) return;
      inFlightByWorkspace.delete(workspaceKey);
      inFlightByWorkspace.set(nextKey, owner);
      workspaceKey = nextKey;
      expectedWorkspacePath = event.after.workspacePath;
      expectedRevision = event.after.revision;
    });
    return {
      source,
      initialContent,
      get workspaceRoot() {
        return expectedWorkspacePath;
      },
      get committed() {
        return committed;
      },
      withWorkspace,
      recordMutation(path: string) {
        assertOwned();
        mutationSeq += 1;
        mutations.add(path);
        verified = undefined;
        acceptedRawSource = undefined;
      },
      runtimeMode(path: string): SourceIdentityV1['runtimeMode'] | undefined {
        if (!source) return undefined;
        return path === source.path
          ? source.runtimeMode
          : source.runtimeMode === 'native-html' && /\.html?$/i.test(path)
            ? 'native-html'
            : 'legacy-auto';
      },
      async verify(
        content: string,
        context: Parameters<DoneRuntimeVerifier>[1],
        verifier: DoneRuntimeVerifier,
      ) {
        verified = undefined;
        acceptedRawSource = undefined;
        const startSeq = mutationSeq;
        return withWorkspace(async (_root, current) => {
          if (
            source &&
            (context?.path !== source.path ||
              !('content' in current) ||
              current.content !== content)
          )
            throw new SourceEntryError(
              'source-changed',
              'Runtime verification must use the exact current primary source.',
            );
          const errors = await verifier(content, {
            ...context,
            path: context?.path ?? source?.path ?? 'App.jsx',
            ...(source ? { runtimeMode: source.runtimeMode } : {}),
            signal,
          });
          assertOwned();
          if (source && errors.length === 0 && mutationSeq === startSeq)
            verified = { content, mutationSeq: startSeq };
          return errors;
        });
      },
      async accept(accepted: { source: SourceIdentityV1; content: string }) {
        assertOwned();
        if (
          !source ||
          !sameSource(source, accepted.source) ||
          !verified ||
          verified.content !== accepted.content ||
          verified.mutationSeq !== mutationSeq
        )
          throw new SourceEntryError(
            'unverified-source',
            'Source acceptance requires current host runtime verification.',
          );
        acceptedRawSource = accepted.content;
      },
      assertArtifact(content: string) {
        if (source && (acceptedRawSource === undefined || content !== acceptedRawSource))
          throw new SourceEntryError(
            'unverified-source',
            'The visual artifact does not match the accepted raw source.',
          );
      },
      async confirm(hasVisualArtifact: boolean) {
        if (!source) return;
        assertOwned();
        if (!hasVisualArtifact) {
          await withWorkspace(async (_root, current) => {
            if (
              acceptedRawSource !== undefined ||
              [...mutations].some((path) => path !== 'DESIGN.md') ||
              !('content' in current) ||
              current.content !== initialContent
            )
              throw new CodesignError(
                'Generation incomplete: workspace edits require a verified visual result.',
                ERROR_CODES.GENERATION_INCOMPLETE,
              );
          });
          return;
        }
        const content = acceptedRawSource;
        if (content === undefined)
          throw new SourceEntryError(
            'unverified-source',
            'Visual completion requires accepted raw source.',
          );
        const validate = () => {
          assertOwned();
          if (
            content !== acceptedRawSource ||
            !verified ||
            verified.content !== content ||
            verified.mutationSeq !== mutationSeq
          )
            throw new SourceEntryError(
              'unverified-source',
              'Visual completion requires exact host-verified raw source acceptance.',
            );
        };
        validate();
        await confirmSourceEntry(
          db,
          {
            schemaVersion: 1,
            designId,
            expectedWorkspacePath,
            expectedRevision,
            source,
            expectedContent: content,
          },
          validate,
          {
            beforeCommit: validate,
            expectedBinding: () => ({ expectedWorkspacePath, expectedRevision }),
            onCommitted: (entry) => {
              expectedRevision = entry.revision;
              committed = true;
            },
          },
        );
      },
      dispose() {
        disposed = true;
        unsubscribe();
        releaseInitial();
        if (inFlightByWorkspace.get(workspaceKey)?.generationId === generationId)
          inFlightByWorkspace.delete(workspaceKey);
      },
    };
  });
}

export type GenerationSource = Awaited<ReturnType<typeof createGenerationSource>>;
