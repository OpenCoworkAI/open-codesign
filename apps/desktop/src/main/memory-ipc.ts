/**
 * Main-process memory I/O — reads/writes per-design memory.md and global
 * memory.md, orchestrates LLM-based memory updates after generation.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  extractSummaryFromMemory,
  formatGlobalMemoryIndex,
  formatMemoryForContext,
  type GlobalMemoryEntry,
  type UpdateDesignMemoryInput,
  updateDesignMemory,
} from '@open-codesign/core';
import type { ModelRef, WireApi } from '@open-codesign/shared';
import { app } from './electron-runtime';
import { getLogger } from './logger';
import { type Database, listDesigns } from './snapshots-db';

const log = getLogger('main:memory');

// ---------------------------------------------------------------------------
// File I/O — best-effort, never throws to caller
// ---------------------------------------------------------------------------

export async function readDesignMemoryFile(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(join(workspacePath, 'memory.md'), 'utf-8');
  } catch {
    return null;
  }
}

export async function writeDesignMemoryFile(workspacePath: string, content: string): Promise<void> {
  const target = join(workspacePath, 'memory.md');
  const tmp = `${target}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, target);
}

function globalMemoryPath(): string {
  return join(app.getPath('userData'), 'memory.md');
}

export async function readGlobalMemoryFile(): Promise<string | null> {
  try {
    return await readFile(globalMemoryPath(), 'utf-8');
  } catch {
    return null;
  }
}

async function writeGlobalMemoryFile(content: string): Promise<void> {
  const target = globalMemoryPath();
  const tmp = `${target}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, target);
}

// ---------------------------------------------------------------------------
// Context loading — called before generation
// ---------------------------------------------------------------------------

export async function loadMemoryContext(
  workspacePath: string | undefined,
): Promise<string[] | undefined> {
  const designMemory = workspacePath ? await readDesignMemoryFile(workspacePath) : null;
  const sections = formatMemoryForContext(designMemory, null);
  return sections.length > 0 ? sections : undefined;
}

// ---------------------------------------------------------------------------
// Global index rebuild — programmatic, no LLM
// ---------------------------------------------------------------------------

async function rebuildGlobalIndex(db: Database | null): Promise<void> {
  if (db === null) return;
  const designs = listDesigns(db);
  const entries: GlobalMemoryEntry[] = [];

  for (const design of designs) {
    if (!design.workspacePath) continue;
    const memory = await readDesignMemoryFile(design.workspacePath);
    if (!memory) continue;
    const summary = extractSummaryFromMemory(memory);
    if (summary.length === 0) continue;
    entries.push({
      designId: design.id,
      designName: design.name,
      summary,
    });
  }

  const content = formatGlobalMemoryIndex(entries);
  await writeGlobalMemoryFile(content);
  log.info('global-index.rebuilt', { entries: entries.length });
}

// ---------------------------------------------------------------------------
// Memory update orchestrator — fire-and-forget from generate
// ---------------------------------------------------------------------------

const inFlightUpdates = new Map<string, Promise<void>>();

export interface TriggerMemoryUpdateOpts {
  workspacePath: string;
  designId: string;
  designName: string;
  conversationMessages: UpdateDesignMemoryInput['conversationMessages'];
  model: ModelRef;
  apiKey: string;
  db: Database | null;
  baseUrl?: string | undefined;
  wire?: WireApi | undefined;
  httpHeaders?: Record<string, string> | undefined;
  allowKeyless?: boolean | undefined;
  reasoningLevel?: UpdateDesignMemoryInput['reasoningLevel'] | undefined;
}

async function doMemoryUpdate(opts: TriggerMemoryUpdateOpts): Promise<void> {
  const existingMemory = await readDesignMemoryFile(opts.workspacePath);

  const result = await updateDesignMemory({
    existingMemory,
    conversationMessages: opts.conversationMessages,
    designId: opts.designId,
    designName: opts.designName,
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

  await writeDesignMemoryFile(opts.workspacePath, result.content);
  log.info('memory.update.ok', {
    designId: opts.designId,
    outputLen: result.content.length,
    cost: result.costUsd,
  });

  await rebuildGlobalIndex(opts.db);
}

export function triggerMemoryUpdate(opts: TriggerMemoryUpdateOpts): Promise<void> {
  const previous = inFlightUpdates.get(opts.designId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => doMemoryUpdate(opts));
  inFlightUpdates.set(opts.designId, next);
  return next.finally(() => {
    if (inFlightUpdates.get(opts.designId) === next) {
      inFlightUpdates.delete(opts.designId);
    }
  });
}
