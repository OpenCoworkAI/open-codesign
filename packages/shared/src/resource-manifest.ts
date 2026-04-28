import type { ChatMessageRow, ChatToolCallPayload } from './snapshot';

export const RESOURCE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RESOURCE_STATE_SCHEMA_VERSION = 1 as const;

export type ResourceManifestCategoryV1 = 'skill' | 'scaffold' | 'brand-ref';

export interface ResourceManifestEntryV1 {
  name: string;
  description: string;
  category: ResourceManifestCategoryV1;
  aliases: string[];
  whenToUse: string;
  dependencies: string[];
  source: string;
  license: string;
  path: string;
}

export interface ResourceManifestV1 {
  schemaVersion: typeof RESOURCE_MANIFEST_SCHEMA_VERSION;
  entries: ResourceManifestEntryV1[];
}

export interface ScaffoldedFileStateV1 {
  kind: string;
  destPath: string;
  bytes: number;
}

export interface LastDoneStateV1 {
  status: 'ok' | 'has_errors';
  path: string;
  mutationSeq: number;
  errorCount: number;
  checkedAt: string;
}

export interface ResourceStateV1 {
  schemaVersion: typeof RESOURCE_STATE_SCHEMA_VERSION;
  loadedSkills: string[];
  loadedBrandRefs: string[];
  scaffoldedFiles: ScaffoldedFileStateV1[];
  lastDone: LastDoneStateV1 | null;
  mutationSeq: number;
}

export function createEmptyResourceState(): ResourceStateV1 {
  return {
    schemaVersion: RESOURCE_STATE_SCHEMA_VERSION,
    loadedSkills: [],
    loadedBrandRefs: [],
    scaffoldedFiles: [],
    lastDone: null,
    mutationSeq: 0,
  };
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (value.length > 0) seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'en'));
}

export function normalizeResourceState(input: ResourceStateV1 | undefined): ResourceStateV1 {
  if (input === undefined) return createEmptyResourceState();
  return {
    schemaVersion: RESOURCE_STATE_SCHEMA_VERSION,
    loadedSkills: uniqueStrings(input.loadedSkills),
    loadedBrandRefs: uniqueStrings(input.loadedBrandRefs),
    scaffoldedFiles: input.scaffoldedFiles.map((file) => ({
      kind: file.kind,
      destPath: file.destPath,
      bytes: file.bytes,
    })),
    lastDone:
      input.lastDone === null
        ? null
        : {
            status: input.lastDone.status,
            path: input.lastDone.path,
            mutationSeq: input.lastDone.mutationSeq,
            errorCount: input.lastDone.errorCount,
            checkedAt: input.lastDone.checkedAt,
          },
    mutationSeq: input.mutationSeq,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDetails(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  const details = result['details'];
  return isRecord(details) ? details : null;
}

function noteMutation(state: ResourceStateV1): void {
  state.mutationSeq += 1;
  state.lastDone = null;
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

export function applyToolCallToResourceState(
  state: ResourceStateV1,
  call: ChatToolCallPayload,
): void {
  if (call.status !== 'done') return;

  if (
    call.toolName === 'str_replace_based_edit_tool' &&
    (call.command === 'create' || call.command === 'str_replace' || call.command === 'insert')
  ) {
    noteMutation(state);
    return;
  }

  const details = getDetails(call.result);
  if (call.toolName === 'generate_image_asset') {
    noteMutation(state);
    return;
  }

  if (call.toolName === 'skill') {
    const name =
      typeof details?.['name'] === 'string'
        ? details['name']
        : typeof call.args['name'] === 'string'
          ? call.args['name']
          : null;
    const status = details?.['status'];
    if (name && status === 'loaded') {
      if (name.startsWith('brand:')) addUnique(state.loadedBrandRefs, name);
      else addUnique(state.loadedSkills, name);
    }
    return;
  }

  if (call.toolName === 'scaffold') {
    if (details?.['ok'] !== true) return;
    const kind =
      typeof details['kind'] === 'string'
        ? details['kind']
        : typeof call.args['kind'] === 'string'
          ? call.args['kind']
          : null;
    const destPath =
      typeof details['destPath'] === 'string'
        ? details['destPath']
        : typeof call.args['destPath'] === 'string'
          ? call.args['destPath']
          : null;
    const bytes = typeof details['bytes'] === 'number' ? details['bytes'] : 0;
    if (kind && destPath) {
      state.scaffoldedFiles.push({ kind, destPath, bytes });
      noteMutation(state);
    }
    return;
  }

  if (call.toolName === 'done') {
    if (details === null) return;
    const status = details?.['status'];
    if (status !== 'ok' && status !== 'has_errors') return;
    const errors = Array.isArray(details['errors']) ? details['errors'] : [];
    state.lastDone = {
      status,
      path: typeof details['path'] === 'string' ? details['path'] : 'index.html',
      mutationSeq: state.mutationSeq,
      errorCount: errors.length,
      checkedAt: new Date().toISOString(),
    };
  }
}

export function deriveResourceStateFromChatRows(rows: readonly ChatMessageRow[]): ResourceStateV1 {
  const state = createEmptyResourceState();
  for (const row of rows) {
    if (row.kind !== 'tool_call') continue;
    const payload = row.payload;
    if (!isRecord(payload)) continue;
    if (typeof payload['toolName'] !== 'string') continue;
    const call: ChatToolCallPayload = {
      toolName: payload['toolName'],
      args: isRecord(payload['args']) ? payload['args'] : {},
      status:
        payload['status'] === 'running' || payload['status'] === 'error'
          ? payload['status']
          : 'done',
      startedAt: typeof payload['startedAt'] === 'string' ? payload['startedAt'] : row.createdAt,
      verbGroup: typeof payload['verbGroup'] === 'string' ? payload['verbGroup'] : 'Working',
      ...(typeof payload['command'] === 'string' ? { command: payload['command'] } : {}),
      ...(payload['result'] !== undefined ? { result: payload['result'] } : {}),
      ...(typeof payload['durationMs'] === 'number' ? { durationMs: payload['durationMs'] } : {}),
      ...(isRecord(payload['error'])
        ? { error: { message: String(payload['error']['message'] ?? '') } }
        : {}),
      ...(typeof payload['toolCallId'] === 'string' ? { toolCallId: payload['toolCallId'] } : {}),
    };
    applyToolCallToResourceState(state, call);
  }
  state.loadedSkills = uniqueStrings(state.loadedSkills);
  state.loadedBrandRefs = uniqueStrings(state.loadedBrandRefs);
  return state;
}
