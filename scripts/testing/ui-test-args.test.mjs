import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUiTestArgs } from '../test-ui.mjs';

test('UI supervisor accepts bounded selection without losing list compatibility', () => {
  assert.deepEqual(parseUiTestArgs(['debug']), { mode: 'debug', list: false });
  assert.deepEqual(parseUiTestArgs(['debug', '--list']), { mode: 'debug', list: true });
  assert.deepEqual(
    parseUiTestArgs([
      'debug',
      '--test-name-pattern',
      'JSONL business|pending question|failed API generation',
    ]),
    {
      mode: 'debug',
      list: false,
      testNamePattern: 'JSONL business|pending question|failed API generation',
    },
  );
  for (const args of [
    ['debug', '--test-name-pattern'],
    ['debug', '--test-name-pattern', ' '],
    ['debug', '--test-name-pattern', '['],
    ['debug', '--list', 'extra'],
    ['debug', '--other'],
  ])
    assert.throws(() => parseUiTestArgs(args));
});
