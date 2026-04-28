import type { ChatMessage } from '@open-codesign/shared';
import { rendererLogger } from '../../lib/renderer-logger.js';
import type { CodesignState } from '../../store.js';
import { autoNameFromPrompt, isDefaultDesignName } from '../lib/auto-name.js';
import { tr } from '../lib/locale.js';

type SetState = (
  updater: ((state: CodesignState) => Partial<CodesignState> | object) | Partial<CodesignState>,
) => void;
type GetState = () => CodesignState;

// Core emits 'html' | 'svg' | 'slides' | 'bundle' but the snapshots schema only
// stores 'html' | 'react' | 'svg' (see DesignSnapshotV1). 'slides'/'bundle' fold
// into 'html' because their on-disk source is HTML — keeping the column
// constraint stable means we don't need a schema migration to persist them.
// Unknown types throw so a new core ArtifactType doesn't silently round-trip
// as the wrong renderer.
export function toSnapshotArtifactType(coreType: string | undefined): 'html' | 'react' | 'svg' {
  switch (coreType) {
    case undefined:
    case 'html':
    case 'slides':
    case 'bundle':
      return 'html';
    case 'svg':
      return 'svg';
    case 'react':
      return 'react';
    default:
      throw new Error(`Unsupported artifact type for snapshot persistence: ${coreType}`);
  }
}

export interface PersistArtifact {
  type: string | undefined;
  content: string;
  prompt: string | null;
  message: string | null;
}

export function artifactFromResult(
  source: { type?: string; content: string } | undefined,
  prompt: string | null,
  message: string | null,
): PersistArtifact | null {
  if (!source) return null;
  return { type: source.type, content: source.content, prompt, message };
}

// PreviewPane keeps an iframe per recently-visited design alive so switching
// back is instant. Bound the pool so memory stays small for users with lots
// of designs — 5 covers the typical "compare two or three" workflow with
// headroom and only costs a few MB of iframe documents.
export const PREVIEW_POOL_LIMIT = 5;

export function recordPreviewInPool(
  prevCache: Record<string, string>,
  prevRecent: string[],
  designId: string,
  html: string | null,
): { cache: Record<string, string>; recent: string[] } {
  const recent = [designId, ...prevRecent.filter((x) => x !== designId)].slice(
    0,
    PREVIEW_POOL_LIMIT,
  );
  const merged = html !== null ? { ...prevCache, [designId]: html } : prevCache;
  const cache: Record<string, string> = {};
  for (const id of recent) {
    if (merged[id] !== undefined) cache[id] = merged[id];
  }
  return { cache, recent };
}

// Per-designId serialization queue. A single generate run reaches this
// function twice — once from applyGenerateResult → persistDesignState and once
// from the agent_end handler → persistAgentRunSnapshot. Without serialization
// both callers race on `snapshots.list`, see zero rows, and both write a fresh
// parent-less 'initial' snapshot. Chaining per design collapses the race and
// lets the content-based dedupe below drop the second write cleanly.
const snapshotPersistLocks = new Map<string, Promise<unknown>>();

export async function persistArtifactSnapshot(
  designId: string,
  artifact: PersistArtifact,
): Promise<string | null> {
  if (!window.codesign) return null;
  const prior = snapshotPersistLocks.get(designId) ?? Promise.resolve();
  const run = prior.then(async () => {
    if (!window.codesign) return null;
    const existing = await window.codesign.snapshots.list(designId);
    const parent = existing[0] ?? null;
    // Dedupe by content: the agent_end path and the generate-result path both
    // fire at the tail of a run and often hold identical html. Returning the
    // existing id avoids duplicate rows without making either caller aware of
    // the other.
    if (parent !== null && parent.artifactSource === artifact.content) {
      return parent.id;
    }
    const created = await window.codesign.snapshots.create({
      designId,
      parentId: parent?.id ?? null,
      type: parent ? 'edit' : 'initial',
      prompt: artifact.prompt,
      artifactType: toSnapshotArtifactType(artifact.type),
      artifactSource: artifact.content,
      ...(artifact.message ? { message: artifact.message } : {}),
    });
    return created?.id ?? null;
  });
  snapshotPersistLocks.set(
    designId,
    run.catch(() => {}),
  );
  return run;
}

/**
 * Rebuild the agent-facing history from chat_messages (single source of truth
 * for the sidebar chat). Only user + assistant_text rows contribute — tool_call
 * / artifact_delivered / error are dropped because the agent re-reads live file
 * state via the edit tool's `view` command. seedFromSnapshots first so legacy designs with
 * only snapshot-era user prompts get backfilled. Falls back to [] when designId
 * is null or IPC is unavailable (renderer tests).
 */
export async function buildHistoryFromChat(designId: string | null): Promise<ChatMessage[]> {
  if (!designId || !window.codesign) return [];
  try {
    await window.codesign.chat.seedFromSnapshots(designId);
    const rows = await window.codesign.chat.list(designId);
    const out: ChatMessage[] = [];
    for (const row of rows) {
      if (row.kind === 'user') {
        const text = (row.payload as { text?: string } | null)?.text;
        if (typeof text === 'string' && text.length > 0) out.push({ role: 'user', content: text });
      } else if (row.kind === 'assistant_text') {
        const text = (row.payload as { text?: string } | null)?.text;
        if (typeof text === 'string' && text.length > 0)
          out.push({ role: 'assistant', content: text });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function persistDesignState(
  get: GetState,
  designId: string,
  previewHtml: string | null,
  artifact: PersistArtifact | null,
): Promise<string | null> {
  if (!window.codesign) return null;
  try {
    let newSnapshotId: string | null = null;
    if (artifact !== null) {
      newSnapshotId = await persistArtifactSnapshot(designId, artifact);
    }
    if (previewHtml !== null) {
      // Thumbnail text = first user prompt ever on this design, sourced from
      // chat_messages (canonical) instead of the removed store.messages mirror.
      let thumbText: string | null = null;
      try {
        const rows = await window.codesign.chat.list(designId);
        const firstUser = rows.find((r) => r.kind === 'user');
        const raw = (firstUser?.payload as { text?: string } | null)?.text;
        if (typeof raw === 'string' && raw.length > 0) thumbText = raw.slice(0, 200);
      } catch {
        // Non-fatal — thumbnail stays unchanged.
      }
      await window.codesign.snapshots.setThumbnail(designId, thumbText);
    }
    await get().loadDesigns();
    return newSnapshotId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : tr('errors.unknown');
    get().pushToast({
      variant: 'error',
      title: tr('projects.notifications.saveFailed'),
      description: msg,
    });
    throw err instanceof Error ? err : new Error(msg);
  }
}

async function maybeAutoRename(
  get: GetState,
  designId: string,
  firstPrompt: string,
): Promise<void> {
  if (!window.codesign) return;
  const design = get().designs.find((d) => d.id === designId);
  if (!design || !isDefaultDesignName(design.name)) return;
  // Try an LLM-generated title first; fall back to a truncation of the prompt
  // if the model call fails (missing key, offline, etc). The fallback is
  // synchronous so the design never stays on "Untitled design N".
  let newName = autoNameFromPrompt(firstPrompt);
  try {
    const api = window.codesign as unknown as {
      generateTitle?: (prompt: string) => Promise<string>;
    };
    if (typeof api.generateTitle === 'function') {
      const generated = await api.generateTitle(firstPrompt);
      const trimmed = generated.trim();
      if (trimmed.length > 0) newName = trimmed;
    }
  } catch (err) {
    rendererLogger.warn('store', '[title] generateTitle failed, using prompt fallback', {
      designId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await window.codesign.snapshots.renameDesign(designId, newName);
    await get().loadDesigns();
  } catch (err) {
    const msg = err instanceof Error ? err.message : tr('errors.unknown');
    get().pushToast({
      variant: 'error',
      title: tr('projects.notifications.renameFailed'),
      description: msg,
    });
    throw err instanceof Error ? err : new Error(msg);
  }
}

export function triggerAutoRenameIfFirst(
  get: GetState,
  isFirstPrompt: boolean,
  prompt: string,
): void {
  if (!isFirstPrompt) return;
  const designId = get().currentDesignId;
  if (designId) void maybeAutoRename(get, designId, prompt);
}

// Re-export SetState usage marker so module surface is explicit.
export type { SetState };
