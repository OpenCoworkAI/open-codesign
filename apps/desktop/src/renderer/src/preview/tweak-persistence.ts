import {
  DEFAULT_SOURCE_ENTRY,
  type EditmodeTokens,
  LEGACY_SOURCE_ENTRY,
  parseEditmodeBlock,
  parseTweakSchema,
  replaceEditmodeBlock,
} from '@open-codesign/shared';
import {
  resolveWorkspacePreviewSource,
  type WorkspacePreviewRead,
  type WorkspacePreviewReadResult,
} from './workspace-source';

export type WorkspacePreviewWrite = (
  designId: string,
  path: string,
  content: string,
  options?: { expectedContent: string },
) => Promise<WorkspacePreviewReadResult>;

export interface PersistTweakTokensResult {
  content: string;
  path: string;
  wrote: boolean;
}

export function rebaseTweakDraft(
  acceptedSource: string,
  submitted: EditmodeTokens,
  draft: EditmodeTokens,
): EditmodeTokens {
  const accepted = parseEditmodeBlock(acceptedSource);
  if (!accepted) throw new Error('Accepted tweak source no longer contains an EDITMODE block.');
  const tokens = { ...accepted.tokens };
  for (const [key, value] of Object.entries(draft)) {
    if (value !== submitted[key]) tokens[key] = value;
  }
  return tokens;
}

export function createTweakPersistDebounce(onIdle?: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let version = 0;
  type Pending = {
    source: string;
    tokens: EditmodeTokens;
    persist: (
      source: string,
      tokens: EditmodeTokens,
    ) => undefined | Promise<PersistTweakTokensResult | undefined>;
  };
  let pending: Pending | null = null;

  async function flush(): Promise<void> {
    if (active || timer !== null || !pending) return;
    const job = pending;
    const jobVersion = version;
    pending = null;
    active = true;
    try {
      const result = await job.persist(job.source, job.tokens);
      if (jobVersion !== version) return;
      if (pending && result) {
        const next: Pending = pending;
        next.tokens = rebaseTweakDraft(result.content, job.tokens, next.tokens);
        next.source = result.content;
      } else if (!result) {
        controller.cancel();
      }
    } finally {
      active = false;
      if (pending) void flush();
      else onIdle?.();
    }
  }

  const controller = {
    hasPending: () => active || pending !== null,
    cancel() {
      version++;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    schedule(source: string, tokens: EditmodeTokens, persist: Pending['persist']) {
      if (timer !== null) clearTimeout(timer);
      // A watcher may refresh source while the user is still typing.
      pending = { source: pending?.source ?? source, tokens, persist };
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, 400);
    },
  };
  return controller;
}

export async function resolveTweakWriteTarget(input: {
  designId: string;
  previewSource: string;
  path?: string | undefined;
  read?: WorkspacePreviewRead | undefined;
}): Promise<WorkspacePreviewReadResult> {
  if (!input.read)
    return { content: input.previewSource, path: input.path ?? DEFAULT_SOURCE_ENTRY };
  if (input.path) return input.read(input.designId, input.path);
  let index: WorkspacePreviewReadResult;
  try {
    index = await input.read(input.designId, DEFAULT_SOURCE_ENTRY);
  } catch {
    index = await input.read(input.designId, LEGACY_SOURCE_ENTRY);
  }
  return await resolveWorkspacePreviewSource({
    designId: input.designId,
    source: index.content,
    path: index.path,
    read: input.read,
  });
}

export function mergeTweakTokenChanges(
  source: string,
  baseSource: string,
  tokens: EditmodeTokens,
): string {
  const base = parseEditmodeBlock(baseSource);
  const current = parseEditmodeBlock(source);
  if (!base || !current) throw new Error('Tweak source no longer contains an EDITMODE block.');
  const schema = parseTweakSchema(source);
  const merged = { ...current.tokens };
  for (const [key, value] of Object.entries(tokens)) {
    if (value === base.tokens[key]) continue;
    if (
      !Object.hasOwn(base.tokens, key) ||
      !Object.hasOwn(current.tokens, key) ||
      (current.tokens[key] !== base.tokens[key] && current.tokens[key] !== value)
    ) {
      throw new Error(`Tweak "${key}" changed in the source. Reload its controls before editing.`);
    }
    if (typeof value !== typeof current.tokens[key]) {
      throw new Error(`Tweak "${key}" has an incompatible value type.`);
    }
    const entry = schema?.[key];
    if (
      typeof value === 'number' &&
      (!Number.isFinite(value) ||
        (entry?.kind === 'number' && (value < (entry.min ?? 0) || value > (entry.max ?? 100))))
    ) {
      throw new Error(`Tweak "${key}" is outside its supported range.`);
    }
    if (entry?.kind === 'enum' && !entry.options.includes(String(value))) {
      throw new Error(`Tweak "${key}" is not a supported option.`);
    }
    merged[key] = value;
  }
  return replaceEditmodeBlock(source, merged);
}

export async function persistTweakTokensToWorkspace(input: {
  designId: string | null;
  previewSource: string;
  path?: string | undefined;
  tokens: EditmodeTokens;
  read?: WorkspacePreviewRead | undefined;
  write?: WorkspacePreviewWrite | undefined;
  canWrite?: (() => boolean) | undefined;
}): Promise<PersistTweakTokensResult> {
  const assertWritable = () => {
    if (input.canWrite && !input.canWrite()) {
      throw new Error('Tweak save cancelled because the active design or generation changed.');
    }
  };
  assertWritable();
  const fallbackContent = mergeTweakTokenChanges(
    input.previewSource,
    input.previewSource,
    input.tokens,
  );
  if (!input.designId || !input.write) {
    return { content: fallbackContent, path: input.path ?? DEFAULT_SOURCE_ENTRY, wrote: false };
  }

  const target = await resolveTweakWriteTarget({
    designId: input.designId,
    previewSource: input.previewSource,
    path: input.path,
    read: input.read,
  });
  const nextContent = mergeTweakTokenChanges(target.content, input.previewSource, input.tokens);
  assertWritable();
  await input.write(input.designId, target.path, nextContent, { expectedContent: target.content });
  return { content: nextContent, path: target.path, wrote: true };
}
