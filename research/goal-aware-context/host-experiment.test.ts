import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hostCompressorMessages,
  hostExperiment,
  hostReaderMessages,
  validHostSummary,
} from './host-experiment';
import { expectedHostAnswers, scoreHostAnswer } from './host-rubric';
import { checkpointIds, replayCheckpoint } from './host-scenarios';

function session(id: (typeof checkpointIds)[number]) {
  return replayCheckpoint(
    id,
    path.join(mkdtempSync(path.join(tmpdir(), 'codesign-host-case-')), 'files'),
  );
}
describe('multi-step hybrid experiment', () => {
  it.each(
    checkpointIds,
  )('host state independently permits the frozen correct decision at %s', (id) => {
    const s = session(id);
    const response = expectedHostAnswers[id];
    expect(scoreHostAnswer(id, response).allCorrect).toBe(true);
    expect(s.host.decide(s.host.frame().id, response).allowed).toBe(true);
  });
  it('actually changes file versions and rejects delayed results across the sequence', () => {
    const ready = session('signup-ready');
    const edited = session('signup-external-edit');
    const partial = session('signup-partial');
    expect(ready.host.snapshot().object.revision).toBe(1);
    expect(edited.host.snapshot().object.revision).toBe(2);
    expect(edited.callbacks.some((r) => r.reason === 'stale-result')).toBe(true);
    expect(partial.callbacks.some((r) => r.reason === 'superseded-check')).toBe(true);
    expect(partial.host.snapshot().verification.map((v) => v.result)).toEqual(['passed', 'failed']);
  });
  it('updates a revoked protection and separates pending work from passed verification', () => {
    const s = session('pricing-pending-work');
    const facts = s.host.snapshot();
    expect(facts.protectedObjects.map((o) => o.id)).toEqual(['pricing/nav']);
    expect(facts.pendingWork).toEqual(['export-job']);
    expect(facts.verification.every((v) => v.result === 'passed')).toBe(true);
    expect(
      s.host.decide(s.host.frame().id, {
        ...expectedHostAnswers['pricing-pending-work'],
        action: 'done',
      }).allowed,
    ).toBe(false);
  });
  it('keeps model-only and hybrid reader contracts identical without model-owned runtime fields', () => {
    const s = session('signup-ready');
    expect(hostReaderMessages(s, 'summary', null)[0]).toEqual(
      hostReaderMessages(s, 'summary', s.host.snapshot())[0],
    );
    const hybrid = JSON.parse(hostCompressorMessages(s, 'host-facts')[1].content);
    expect(hybrid.history.every((item: { role: string }) => item.role !== 'tool')).toBe(true);
    expect(Object.keys(hybrid).sort()).toEqual(['goal', 'history']);
    expect(hostCompressorMessages(s, 'host-facts')[0].content).not.toContain('expectedHostAnswers');
  });
  it('counts UTF-8 bytes, rejects forged authority and malformed actions', () => {
    expect(validHostSummary({ summary: '中'.repeat(600) })).toBe(true);
    expect(validHostSummary({ summary: '中'.repeat(601) })).toBe(false);
    expect(
      scoreHostAnswer('signup-ready', { ...expectedHostAnswers['signup-ready'], action: ['done'] })
        .valid,
    ).toBe(false);
    expect(
      scoreHostAnswer('signup-ready', {
        ...expectedHostAnswers['signup-ready'],
        sourceHash: 'fake',
      }).valid,
    ).toBe(false);
  });
  it('runs the protocol with injected decisions and does not count safe rejection as success', async () => {
    const output = path.join(mkdtempSync(path.join(tmpdir(), 'codesign-host-protocol-')), 'run');
    const rows = await hostExperiment(output, async (id) => {
      if (id.endsWith('/compress'))
        return { status: 'ok', value: { summary: 'synthetic test summary' } };
      const key = id.split('/')[0] as (typeof checkpointIds)[number];
      return { status: 'ok', value: { ...expectedHostAnswers[key], action: 'done', checks: [] } };
    });
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.score.prematureDone)).toHaveLength(8);
    expect(rows.filter((r) => r.guard && !r.guard.allowed)).toHaveLength(8);
    expect(rows.filter((r) => r.guard?.allowed && r.score.prematureDone)).toHaveLength(0);
    expect(JSON.parse(readFileSync(path.join(output, 'plan.json'), 'utf8')).maxCalls).toBe(24);
  });
});
