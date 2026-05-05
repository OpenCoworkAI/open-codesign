import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DesignSessionBriefV1, SessionManager } from '@open-codesign/core';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSessionChatMessage,
  appendSessionComment,
  appendSessionDesignBrief,
  appendSessionRunPreferences,
  appendSessionToolStatus,
  CHAT_TOOL_STATUS_CUSTOM_TYPE,
  CONTEXT_BRIEF_CUSTOM_TYPE,
  listSessionChatMessages,
  listSessionComments,
  markSessionCommentsApplied,
  readSessionDesignBrief,
  readSessionRunPreferences,
  removeSessionComment,
  seedSessionChatFromSnapshots,
  updateSessionComment,
} from './session-chat';
import {
  createDesign,
  createSnapshot,
  getDesign,
  initSnapshotsDb,
  updateDesignWorkspace,
} from './snapshots-db';

function brief(goal: string): DesignSessionBriefV1 {
  return {
    schemaVersion: 1,
    designId: 'design-1',
    designName: 'Test design',
    updatedAt: '2026-05-05T00:00:00.000Z',
    goal,
    artifactType: 'dashboard',
    audience: 'Operators',
    visualDirection: 'Clean',
    stableDecisions: [],
    userPreferences: [],
    dislikes: [],
    openTasks: [],
    currentFiles: ['App.jsx'],
    lastVerification: { status: 'none' },
    lastUserIntent: '',
  };
}

describe('session design brief storage', () => {
  it('touches design activity when appending chat and tool events', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-chat-'));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Chat activity');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
      const message = appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'user',
        payload: { text: 'iterate the dashboard' },
      });

      expect(message.createdAt).toBe('2026-05-02T00:00:00.000Z');
      expect(getDesign(db, design.id)?.updatedAt).toBe('2026-05-02T00:00:00.000Z');

      vi.setSystemTime(new Date('2026-05-03T00:00:00.000Z'));
      const toolMessage = appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'tool_call',
        payload: { toolName: 'preview', args: {}, status: 'running' },
      });
      appendSessionToolStatus(opts, {
        designId: design.id,
        seq: toolMessage.seq,
        status: 'done',
      });

      expect(getDesign(db, design.id)?.updatedAt).toBe('2026-05-03T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not make seeded legacy snapshot history look like fresh activity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-seed-'));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Seeded history');
      updateDesignWorkspace(db, design.id, root);
      createSnapshot(db, {
        designId: design.id,
        parentId: null,
        type: 'initial',
        prompt: 'make a homepage',
        artifactType: 'html',
        artifactSource: '<main>Hello</main>',
      });
      const beforeSeed = getDesign(db, design.id)?.updatedAt;

      vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
      const inserted = seedSessionChatFromSnapshots({ db, sessionDir: db.sessionDir }, design.id);

      expect(inserted).toBe(2);
      expect(getDesign(db, design.id)?.updatedAt).toBe(beforeSeed);
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores orphan tool-status entries when replaying chat history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-orphan-status-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Orphan status');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'user',
        payload: { text: 'make a stats strip' },
      });

      const safeId = design.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(db.sessionDir, `${safeId}.jsonl`);
      const manager = SessionManager.open(file, db.sessionDir, root);
      manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, {
        schemaVersion: 1,
        seq: 99,
        status: 'done',
      });
      const header = manager.getHeader();
      if (header === null) throw new Error('missing session header');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${[header, ...manager.getEntries()].map((e) => JSON.stringify(e)).join('\n')}\n`,
      );

      const rows = listSessionChatMessages(opts, design.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('user');
      expect(seedSessionChatFromSnapshots(opts, design.id)).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores orphan tool-status entries even when mixed around valid tool rows', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-mixed-status-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Mixed orphan status');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'user',
        payload: { text: 'build a deck' },
      });
      const toolRow = appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'tool_call',
        payload: { toolName: 'preview', args: {}, status: 'running' },
      });

      const safeId = design.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(db.sessionDir, `${safeId}.jsonl`);
      const manager = SessionManager.open(file, db.sessionDir, root);
      manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, {
        schemaVersion: 1,
        seq: 999,
        status: 'error',
        errorMessage: 'orphaned',
      });
      manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, {
        schemaVersion: 1,
        seq: toolRow.seq,
        status: 'done',
      });
      manager.appendCustomEntry(CHAT_TOOL_STATUS_CUSTOM_TYPE, {
        schemaVersion: 1,
        seq: 1000,
        status: 'done',
      });
      const header = manager.getHeader();
      if (header === null) throw new Error('missing session header');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${[header, ...manager.getEntries()].map((e) => JSON.stringify(e)).join('\n')}\n`,
      );

      const rows = listSessionChatMessages(opts, design.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.kind).toBe('tool_call');
      expect((rows[1]?.payload as { status?: string } | undefined)?.status).toBe('done');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not append tool status updates for missing messages', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-missing-status-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Missing status target');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'user',
        payload: { text: 'hello' },
      });
      appendSessionToolStatus(opts, { designId: design.id, seq: 99, status: 'done' });

      const safeId = design.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(db.sessionDir, `${safeId}.jsonl`);
      expect(readFileSync(file, 'utf8')).not.toContain(CHAT_TOOL_STATUS_CUSTOM_TYPE);
      expect(listSessionChatMessages(opts, design.id)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts oversized tool results before writing tool-status entries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-compact-status-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Compact status');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      const toolRow = appendSessionChatMessage(opts, {
        designId: design.id,
        kind: 'tool_call',
        payload: { toolName: 'preview', args: {}, status: 'running' },
      });

      appendSessionToolStatus(opts, {
        designId: design.id,
        seq: toolRow.seq,
        status: 'done',
        result: {
          content: [{ type: 'text', text: 'preview ok' }],
          details: {
            ok: true,
            screenshot: `data:image/png;base64,${'x'.repeat(50_000)}`,
            domOutline: 'd'.repeat(8_000),
            consoleErrors: Array.from({ length: 25 }, (_, index) => ({
              level: 'error',
              message: `console ${index}`,
            })),
            assetErrors: Array.from({ length: 25 }, (_, index) => ({
              url: `https://cdn.example/${index}`,
              status: 404,
            })),
          },
        },
      });

      const rows = listSessionChatMessages(opts, design.id);
      const replayed = rows.find((row) => row.seq === toolRow.seq);
      const payload = replayed?.payload as
        | { result?: { details?: Record<string, unknown> } }
        | undefined;
      expect(payload?.result?.details?.['screenshot']).toBe('[stripped for chat history]');
      expect((payload?.result?.details?.['consoleErrors'] as unknown[])?.length).toBe(10);

      const safeId = design.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(db.sessionDir, `${safeId}.jsonl`);
      expect(readFileSync(file, 'utf8')).not.toContain('data:image/png;base64');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('appends and reads the latest design session brief from JSONL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-brief-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Brief test');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionDesignBrief(opts, design.id, brief('First goal'));
      appendSessionDesignBrief(opts, design.id, brief('Latest goal'));

      expect(readSessionDesignBrief(opts, design.id)?.goal).toBe('Latest goal');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('appends and reads the latest run preferences from JSONL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-prefs-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Run prefs test');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionRunPreferences(opts, design.id, {
        schemaVersion: 1,
        tweaks: 'no',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      });
      appendSessionRunPreferences(opts, design.id, {
        schemaVersion: 1,
        tweaks: 'yes',
        bitmapAssets: 'no',
        reusableSystem: 'auto',
        visualDirection: 'professional',
      });

      expect(readSessionRunPreferences(opts, design.id)).toEqual({
        schemaVersion: 1,
        tweaks: 'yes',
        bitmapAssets: 'no',
        reusableSystem: 'auto',
        visualDirection: 'professional',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replays comment add/update/remove/apply events from JSONL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-comments-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Comment test');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      const row = appendSessionComment(opts, {
        designId: design.id,
        snapshotId: 'snapshot-a',
        kind: 'edit',
        selector: '#hero',
        tag: 'section',
        outerHTML: '<section id="hero">Hello</section>',
        rect: { top: 1, left: 2, width: 3, height: 4 },
        text: 'Make it bolder',
      });

      expect(listSessionComments(opts, design.id)).toMatchObject([
        { id: row.id, status: 'pending', text: 'Make it bolder' },
      ]);

      expect(
        updateSessionComment(opts, design.id, row.id, { text: 'Make it calmer' }),
      ).toMatchObject({ id: row.id, text: 'Make it calmer' });
      expect(markSessionCommentsApplied(opts, design.id, [row.id], 'snapshot-b')).toMatchObject([
        { id: row.id, status: 'applied', appliedInSnapshotId: 'snapshot-b' },
      ]);
      expect(removeSessionComment(opts, design.id, row.id)).toBe(true);
      expect(listSessionComments(opts, design.id)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores malformed brief entries and falls back to the latest valid one', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codesign-session-brief-'));
    try {
      const db = initSnapshotsDb(path.join(root, 'design-store.json'));
      const design = createDesign(db, 'Brief test');
      updateDesignWorkspace(db, design.id, root);
      const opts = { db, sessionDir: db.sessionDir };

      appendSessionDesignBrief(opts, design.id, brief('Valid goal'));

      const safeId = design.id.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = path.join(db.sessionDir, `${safeId}.jsonl`);
      const manager = SessionManager.open(file, db.sessionDir, root);
      manager.appendCustomEntry(CONTEXT_BRIEF_CUSTOM_TYPE, {
        schemaVersion: 1,
        brief: { bad: true },
      });
      const header = manager.getHeader();
      if (header === null) throw new Error('missing session header');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${[header, ...manager.getEntries()].map((e) => JSON.stringify(e)).join('\n')}\n`,
      );

      expect(readSessionDesignBrief(opts, design.id)?.goal).toBe('Valid goal');
      expect(readFileSync(file, 'utf8')).toContain(CONTEXT_BRIEF_CUSTOM_TYPE);

      appendFileSync(file, '');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
