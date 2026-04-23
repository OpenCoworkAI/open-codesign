/**
 * Unit tests for the diagnostic_events store in designs-db.ts.
 *
 * Covers 200ms dedup window, transient OR-merge on dedup, run_id-insensitive
 * fingerprint matching, list filtering, and prune behaviour. Uses an isolated
 * in-memory SQLite instance — no Electron, no filesystem.
 */

import type { DiagnosticEventInput } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import {
  initInMemoryDb,
  listDiagnosticEvents,
  pruneDiagnosticEvents,
  recordDiagnosticEvent,
} from './designs-db';

function baseInput(overrides: Partial<DiagnosticEventInput> = {}): DiagnosticEventInput {
  return {
    level: 'error',
    code: 'E_TEST',
    scope: 'test',
    runId: undefined,
    fingerprint: 'fp-a',
    message: 'boom',
    stack: undefined,
    transient: false,
    ...overrides,
  };
}

function fixedNow(value: number): () => number {
  return () => value;
}

describe('recordDiagnosticEvent', () => {
  it('inserts a new row when no event with that fingerprint exists', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput(), fixedNow(1_000));

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fingerprint).toBe('fp-a');
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.ts).toBe(1_000);
    expect(rows[0]?.transient).toBe(false);
  });

  it('dedups within the 200ms window — bumps count and ts on the existing row', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput(), fixedNow(1_000));
    recordDiagnosticEvent(db, baseInput(), fixedNow(1_150));

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.ts).toBe(1_150);
  });

  it('does NOT dedup after 200ms — inserts a second row', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput(), fixedNow(0));
    recordDiagnosticEvent(db, baseInput(), fixedNow(201));

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });

  it('dedup ignores run_id when fingerprints match inside the window', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput({ runId: 'run-1' }), fixedNow(1_000));
    recordDiagnosticEvent(db, baseInput({ runId: 'run-2' }), fixedNow(1_100));

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    // The first inserted row's run_id is preserved — the second caller's run_id
    // does not overwrite it on dedup.
    expect(rows[0]?.runId).toBe('run-1');
  });

  it('OR-merges the transient flag on dedup', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput({ transient: false }), fixedNow(1_000));
    recordDiagnosticEvent(db, baseInput({ transient: true }), fixedNow(1_100));

    const rows = listDiagnosticEvents(db, { includeTransient: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transient).toBe(true);
  });
});

describe('listDiagnosticEvents', () => {
  it('returns rows newest-first', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(
      db,
      baseInput({ fingerprint: 'fp-a', message: 'first' }),
      fixedNow(1_000),
    );
    recordDiagnosticEvent(
      db,
      baseInput({ fingerprint: 'fp-b', message: 'second' }),
      fixedNow(2_000),
    );
    recordDiagnosticEvent(
      db,
      baseInput({ fingerprint: 'fp-c', message: 'third' }),
      fixedNow(3_000),
    );

    const rows = listDiagnosticEvents(db);
    expect(rows.map((r) => r.message)).toEqual(['third', 'second', 'first']);
  });

  it('filters transient rows by default', () => {
    const db = initInMemoryDb();
    recordDiagnosticEvent(db, baseInput({ fingerprint: 'fp-keep' }), fixedNow(1_000));
    recordDiagnosticEvent(
      db,
      baseInput({ fingerprint: 'fp-drop', transient: true }),
      fixedNow(2_000),
    );

    const visible = listDiagnosticEvents(db);
    expect(visible.map((r) => r.fingerprint)).toEqual(['fp-keep']);

    const all = listDiagnosticEvents(db, { includeTransient: true });
    expect(all).toHaveLength(2);
  });
});

describe('pruneDiagnosticEvents', () => {
  it('keeps the newest N rows and returns the number of deleted rows', () => {
    const db = initInMemoryDb();
    for (let i = 0; i < 5; i += 1) {
      recordDiagnosticEvent(
        db,
        baseInput({ fingerprint: `fp-${i}`, message: `msg-${i}` }),
        fixedNow(1_000 + i * 500),
      );
    }

    const deleted = pruneDiagnosticEvents(db, 2);
    expect(deleted).toBe(3);

    const remaining = listDiagnosticEvents(db, { includeTransient: true });
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.fingerprint)).toEqual(['fp-4', 'fp-3']);
  });
});
