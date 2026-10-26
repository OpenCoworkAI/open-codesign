import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostCompressorMessages, validHostSummary } from './host-experiment.js';
import { replayCheckpoint } from './host-scenarios.js';
import { compressorMessages, validSummary } from './live-experiment.mjs';

describe('reused summary protocol', () => {
  it('supports a frozen per-run byte cap while preserving the legacy default', () => {
    const source = { goal: 'resume', history: [{ role: 'user', text: 'KEEP_ME' }] };
    expect(compressorMessages(source, 'goal-record', 64)[0]?.content).toContain('64 UTF-8 bytes');
    expect(compressorMessages(source, 'ordinary-summary')[0]?.content).toContain(
      '1800 UTF-8 bytes',
    );
    expect(validSummary({ summary: '中'.repeat(22) }, 64)).toBe(false);
    expect(validSummary({ summary: '中'.repeat(21) }, 64)).toBe(true);
  });
  it('uses the same configurable cap for the existing host prompt and validator', () => {
    const base = fileURLToPath(
      new URL(
        '../../.Codex/workspace/goal-aware-context/unified-runner/prompt-tests/',
        import.meta.url,
      ),
    );
    mkdirSync(base, { recursive: true });
    const session = replayCheckpoint(
      'signup-ready',
      join(mkdtempSync(join(base, 'run-')), 'files'),
    );
    expect(hostCompressorMessages(session, 'model-record', 64)[0]?.content).toContain(
      '64 UTF-8 bytes',
    );
    expect(validHostSummary({ summary: '中'.repeat(22) }, 64)).toBe(false);
  });
});

it('rejects invalid public summary limits instead of disabling the cap', () => {
  expect(validSummary({ summary: 'x' }, Infinity)).toBe(false);
  expect(validHostSummary({ summary: 'x' }, Infinity)).toBe(false);
  expect(() => compressorMessages({ goal: 'resume', history: [] }, 'goal-record', 0)).toThrow();
});
