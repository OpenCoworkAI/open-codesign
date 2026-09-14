/**
 * Main-process memory I/O.
 *
 * Global user memory lives under userData. Workspace MEMORY.md lives beside
 * App.jsx / DESIGN.md and is user-readable. Session briefs remain in JSONL.
 */

import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  formatMemoryContext,
  type UpdateUserMemoryInput,
  type UpdateWorkspaceMemoryInput,
  updateUserMemory,
  updateWorkspaceMemory,
} from '@open-codesign/core';
import { getCodexTokenStore } from './codex-oauth-ipc';
import { canonicalInvokeBaseUrl } from './effective-provider-contract';
import { app, ipcMain, shell } from './electron-runtime';
import { getLogger } from './logger';
import { getApiKeyForProvider, getCachedConfig, hasApiKeyForProvider } from './onboarding-ipc';
import { resolveActiveModel } from './provider-settings';
import { resolveCredentialForProvider } from './resolve-api-key';
import { normalizeWorkspacePath } from './workspace-path';

const log = getLogger('main:memory');
const PRIMARY_WORKSPACE_MEMORY = 'MEMORY.md';
const LEGACY_WORKSPACE_MEMORY = 'memory.md';
const USER_MEMORY_REL = ['memory', 'user.md'] as const;
const USER_CANDIDATES_REL = ['memory', 'user-candidates.jsonl'] as const;
const USER_MEMORY_CANDIDATE_THRESHOLD = 5;
const USER_MEMORY_CONSOLIDATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MemoryFileRead {
  content: string;
  path: string;
  hash: string;
  mtimeMs: number;
  updatedAt: string;
  source: 'primary' | 'legacy' | 'user';
}

export interface LoadedMemoryContext {
  sections: string[];
  userMemory: MemoryFileRead | null;
  workspaceMemory: MemoryFileRead | null;
}

interface TriggerWorkspaceMemoryUpdateOpts
  extends Omit<UpdateWorkspaceMemoryInput, 'existingMemory'> {
  workspacePath: string;
}

export interface UserMemoryCandidateCaptureInput {
  designId: string;
  designName: string;
  userMessages: string[];
}

export interface TriggerUserMemoryConsolidationOpts
  extends Omit<UpdateUserMemoryInput, 'existingMemory' | 'candidates'> {
  force?: boolean | undefined;
}

export interface UserMemoryConsolidationResult {
  updated: boolean;
  candidateCount: number;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function userMemoryPath(): string {
  return join(app.getPath('userData'), ...USER_MEMORY_REL);
}

function userCandidatesPath(): string {
  return join(app.getPath('userData'), ...USER_CANDIDATES_REL);
}

function workspaceMemoryPath(workspacePath: string): string {
  return join(normalizeWorkspacePath(workspacePath), PRIMARY_WORKSPACE_MEMORY);
}

function legacyWorkspaceMemoryPath(workspacePath: string): string {
  return join(normalizeWorkspacePath(workspacePath), LEGACY_WORKSPACE_MEMORY);
}

async function readMemoryFile(
  file: string,
  source: MemoryFileRead['source'],
): Promise<MemoryFileRead | null> {
  try {
    if (!(await exactPathExists(file))) return null;
    const content = await readFile(file, 'utf-8');
    const info = await stat(file);
    return {
      content,
      path: file,
      hash: hashContent(content),
      mtimeMs: info.mtimeMs,
      updatedAt: info.mtime.toISOString(),
      source,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function exactPathExists(file: string): Promise<boolean> {
  try {
    const entries = await readdir(dirname(file));
    return entries.includes(basename(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, file);
}

export async function readUserMemoryFile(): Promise<MemoryFileRead | null> {
  return readMemoryFile(userMemoryPath(), 'user');
}

export async function writeUserMemoryFileAtomic(content: string): Promise<void> {
  await writeAtomic(userMemoryPath(), content);
}

export async function readWorkspaceMemoryFile(
  workspacePath: string,
): Promise<MemoryFileRead | null> {
  const primary = await readMemoryFile(workspaceMemoryPath(workspacePath), 'primary');
  if (primary !== null) return primary;
  return readMemoryFile(legacyWorkspaceMemoryPath(workspacePath), 'legacy');
}

export async function writeWorkspaceMemoryFileAtomic(
  workspacePath: string,
  content: string,
): Promise<void> {
  const primary = workspaceMemoryPath(workspacePath);
  const legacy = legacyWorkspaceMemoryPath(workspacePath);
  await mkdir(dirname(primary), { recursive: true });
  if (!(await exactPathExists(primary)) && (await exactPathExists(legacy))) {
    await rm(legacy, { force: true });
  }
  await writeAtomic(primary, content);
}

export async function loadMemoryContext(
  workspacePath: string | undefined,
): Promise<LoadedMemoryContext | undefined> {
  const [userMemory, workspaceMemory] = await Promise.all([
    readUserMemoryFile(),
    workspacePath ? readWorkspaceMemoryFile(workspacePath) : Promise.resolve(null),
  ]);
  const sections = formatMemoryContext({
    userMemory: userMemory?.content ?? null,
    workspaceMemory: workspaceMemory?.content ?? null,
  });
  if (sections.length === 0 && userMemory === null && workspaceMemory === null) return undefined;
  return { sections, userMemory, workspaceMemory };
}

const workspaceUpdateLocks = new Map<string, Promise<MemoryFileRead | null>>();

async function runWorkspaceMemoryUpdateOnce(
  opts: TriggerWorkspaceMemoryUpdateOpts,
  existing: MemoryFileRead | null,
  mergeDraft?: string,
): Promise<{
  result: Awaited<ReturnType<typeof updateWorkspaceMemory>>;
  before: MemoryFileRead | null;
}> {
  const result = await updateWorkspaceMemory({
    existingMemory: existing?.content ?? null,
    conversationMessages: opts.conversationMessages,
    workspaceName: opts.workspaceName,
    designId: opts.designId,
    designName: opts.designName,
    userMemory: opts.userMemory,
    designMdSummary: opts.designMdSummary,
    ...(mergeDraft !== undefined ? { mergeDraft } : {}),
    model: opts.model,
    apiKey: opts.apiKey,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.wire !== undefined ? { wire: opts.wire } : {}),
    ...(opts.httpHeaders !== undefined ? { httpHeaders: opts.httpHeaders } : {}),
    ...(opts.allowKeyless === true ? { allowKeyless: true } : {}),
    ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
    logger: {
      info: (event, data) => log.info(event, data),
      warn: (event, data) => log.warn(event, data),
      error: (event, data) => log.error(event, data),
    },
  });
  return { result, before: existing };
}

async function doWorkspaceMemoryUpdate(
  opts: TriggerWorkspaceMemoryUpdateOpts,
): Promise<MemoryFileRead | null> {
  const before = await readWorkspaceMemoryFile(opts.workspacePath);
  const first = await runWorkspaceMemoryUpdateOnce(opts, before);
  const current = await readWorkspaceMemoryFile(opts.workspacePath);
  if ((before?.hash ?? null) === (current?.hash ?? null)) {
    await writeWorkspaceMemoryFileAtomic(opts.workspacePath, first.result.content);
    const written = await readWorkspaceMemoryFile(opts.workspacePath);
    log.info('workspace-memory.update.ok', {
      designId: opts.designId,
      workspacePath: opts.workspacePath,
      outputLen: first.result.content.length,
      cost: first.result.costUsd,
    });
    return written;
  }

  log.warn('workspace-memory.update.conflict.retry', {
    designId: opts.designId,
    workspacePath: opts.workspacePath,
  });
  const retryBase = current;
  const second = await runWorkspaceMemoryUpdateOnce(opts, retryBase, first.result.content);
  const currentAfterRetry = await readWorkspaceMemoryFile(opts.workspacePath);
  if ((retryBase?.hash ?? null) !== (currentAfterRetry?.hash ?? null)) {
    log.warn('workspace-memory.update.conflict.skip', {
      designId: opts.designId,
      workspacePath: opts.workspacePath,
    });
    return currentAfterRetry;
  }
  await writeWorkspaceMemoryFileAtomic(opts.workspacePath, second.result.content);
  return readWorkspaceMemoryFile(opts.workspacePath);
}

export function triggerWorkspaceMemoryUpdate(
  opts: TriggerWorkspaceMemoryUpdateOpts,
): Promise<MemoryFileRead | null> {
  const key = normalizeWorkspacePath(opts.workspacePath);
  const previous = workspaceUpdateLocks.get(key) ?? Promise.resolve(null);
  const next = previous.catch(() => null).then(() => doWorkspaceMemoryUpdate(opts));
  workspaceUpdateLocks.set(key, next);
  return next.finally(() => {
    if (workspaceUpdateLocks.get(key) === next) workspaceUpdateLocks.delete(key);
  });
}

function isUsefulUserMemoryCandidate(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 12) return false;
  return /\b(prefer|usually|always|never|hate|dislike|喜欢|偏好|不要|不喜欢|总是|通常)\b/i.test(
    trimmed,
  );
}

export async function triggerUserMemoryCandidateCapture(
  input: UserMemoryCandidateCaptureInput,
): Promise<void> {
  const candidates = input.userMessages
    .map((msg) => msg.trim())
    .filter(isUsefulUserMemoryCandidate);
  if (candidates.length === 0) return;
  const file = userCandidatesPath();
  await mkdir(dirname(file), { recursive: true });
  const now = new Date().toISOString();
  const lines = candidates.map((text) =>
    JSON.stringify({
      schemaVersion: 1,
      capturedAt: now,
      designId: input.designId,
      designName: input.designName,
      text,
    }),
  );
  await appendFile(file, `${lines.join('\n')}\n`, 'utf-8');
}

export async function clearUserMemoryCandidates(): Promise<void> {
  await rm(userCandidatesPath(), { force: true });
}

async function readUserMemoryCandidates(): Promise<string[]> {
  try {
    const raw = await readFile(userCandidatesPath(), 'utf-8');
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as { text?: unknown; capturedAt?: unknown };
        if (typeof parsed.text === 'string') out.push(parsed.text);
      } catch {
        // Ignore one malformed candidate line rather than losing the whole queue.
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

const userUpdateLocks = new Map<string, Promise<UserMemoryConsolidationResult>>();

async function doUserMemoryConsolidation(
  opts: TriggerUserMemoryConsolidationOpts,
): Promise<UserMemoryConsolidationResult> {
  const candidates = await readUserMemoryCandidates();
  const existing = await readUserMemoryFile();
  const lastUpdated = existing?.mtimeMs ?? 0;
  const dueByAge =
    candidates.length > 0 && Date.now() - lastUpdated > USER_MEMORY_CONSOLIDATION_INTERVAL_MS;
  if (opts.force !== true && candidates.length < USER_MEMORY_CANDIDATE_THRESHOLD && !dueByAge) {
    return { updated: false, candidateCount: candidates.length };
  }
  if (candidates.length === 0) return { updated: false, candidateCount: 0 };

  const result = await updateUserMemory({
    existingMemory: existing?.content ?? null,
    candidates,
    model: opts.model,
    apiKey: opts.apiKey,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.wire !== undefined ? { wire: opts.wire } : {}),
    ...(opts.httpHeaders !== undefined ? { httpHeaders: opts.httpHeaders } : {}),
    ...(opts.allowKeyless === true ? { allowKeyless: true } : {}),
    ...(opts.reasoningLevel !== undefined ? { reasoningLevel: opts.reasoningLevel } : {}),
    logger: {
      info: (event, data) => log.info(event, data),
      warn: (event, data) => log.warn(event, data),
      error: (event, data) => log.error(event, data),
    },
  });
  await writeUserMemoryFileAtomic(result.content);
  await rm(userCandidatesPath(), { force: true });
  return { updated: true, candidateCount: candidates.length };
}

export function triggerUserMemoryConsolidation(
  opts: TriggerUserMemoryConsolidationOpts,
): Promise<UserMemoryConsolidationResult> {
  const key = 'user';
  const previous =
    userUpdateLocks.get(key) ?? Promise.resolve({ updated: false, candidateCount: 0 });
  const next = previous
    .catch(() => ({ updated: false, candidateCount: 0 }))
    .then(() => doUserMemoryConsolidation(opts));
  userUpdateLocks.set(key, next);
  return next.finally(() => {
    if (userUpdateLocks.get(key) === next) userUpdateLocks.delete(key);
  });
}

export function workspaceNameFromPath(workspacePath: string): string {
  return basename(resolve(workspacePath)) || 'Workspace';
}

export function userMemoryFilePath(): string {
  return userMemoryPath();
}

export async function openUserMemoryFile(): Promise<void> {
  await mkdir(dirname(userMemoryPath()), { recursive: true });
  const existing = await readUserMemoryFile();
  if (existing === null) await writeUserMemoryFileAtomic('');
  const result = await shell.openPath(userMemoryPath());
  if (result.length > 0) throw new Error(`Failed to open user memory file: ${result}`);
}

async function resolveUserMemoryConsolidationOptions(
  force: boolean,
): Promise<TriggerUserMemoryConsolidationOpts> {
  const cfg = getCachedConfig();
  if (cfg === null) throw new Error('No model provider is configured yet.');
  const active = resolveActiveModel(cfg, {
    provider: cfg.activeProvider,
    modelId: cfg.activeModel,
  });
  const apiKey = await resolveCredentialForProvider(active.model.provider, active.allowKeyless, {
    getCodexAccessToken: () => getCodexTokenStore().getValidAccessToken(),
    getApiKeyForProvider,
    hasApiKeyForProvider,
  });
  const baseUrl = canonicalInvokeBaseUrl(active.baseUrl, active.wire);
  return {
    force,
    model: active.model,
    apiKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    wire: active.wire,
    ...(active.httpHeaders !== undefined ? { httpHeaders: active.httpHeaders } : {}),
    ...(active.reasoningLevel !== undefined ? { reasoningLevel: active.reasoningLevel } : {}),
    ...(active.allowKeyless ? { allowKeyless: true } : {}),
  };
}

export function registerMemoryIpc(): void {
  ipcMain.handle('memory:v1:get-user', async () => {
    const existing = await readUserMemoryFile();
    return (
      existing ?? {
        content: '',
        path: userMemoryPath(),
        hash: hashContent(''),
        mtimeMs: 0,
        updatedAt: '',
        source: 'user' as const,
      }
    );
  });
  ipcMain.handle('memory:v1:update-user', async (_event, content: unknown) => {
    if (typeof content !== 'string') throw new Error('memory:v1:update-user expects string');
    await writeUserMemoryFileAtomic(content);
    return readUserMemoryFile();
  });
  ipcMain.handle('memory:v1:open-user', async () => openUserMemoryFile());
  ipcMain.handle('memory:v1:consolidate-user', async () =>
    triggerUserMemoryConsolidation(await resolveUserMemoryConsolidationOptions(true)),
  );
  ipcMain.handle('memory:v1:clear-user-candidates', async () => clearUserMemoryCandidates());
}
