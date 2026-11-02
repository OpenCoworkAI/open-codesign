import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { parseArguments } from './arguments';
import { runUiSession } from './ui-session';

it('reports a busy UI lease as exit 4 without starting a session or echoing host details', async () => {
  const messages: unknown[] = [];
  const code = await runUiSession(
    parseArguments(['debug', 'session', '--output', 'unused-output']),
    new PassThrough(),
    (line) => messages.push(JSON.parse(line)),
    new AbortController().signal,
    async () => ({
      loadUiSteps: async () => [],
      validateUiSteps: () => [],
      runUiDebug: async () => {
        throw new Error('UI_DEBUG_BUSY: private-sentinel');
      },
    }),
  );
  expect(code).toBe(4);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    type: 'closed',
    ok: false,
    error: { code: 'UI_DEBUG_BUSY', exitCode: 4 },
  });
  expect(JSON.stringify(messages)).not.toContain('private-sentinel');
});
