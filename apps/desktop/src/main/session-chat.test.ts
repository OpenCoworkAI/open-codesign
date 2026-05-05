import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DesignSessionBriefV1, SessionManager } from '@open-codesign/core';
import { describe, expect, it, vi } from 'vitest';
import {
  appendSessionChatMessage,
  appendSessionDesignBrief,
  appendSessionToolStatus,
  CONTEXT_BRIEF_CUSTOM_TYPE,
  readSessionDesignBrief,
  seedSessionChatFromSnapshots,
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
      appendSessionToolStatus(opts, {
        designId: design.id,
        seq: 0,
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
