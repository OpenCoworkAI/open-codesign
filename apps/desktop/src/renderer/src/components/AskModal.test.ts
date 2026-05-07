// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import type { AskRequest } from '../../../preload/index';
import { advanceAskQueue, enqueueAskRequest, sanitizeInlineSvg } from './AskModal';

const request = (requestId: string): AskRequest => ({
  requestId,
  sessionId: `session-${requestId}`,
  input: {
    questions: [{ id: 'q1', type: 'freeform', prompt: 'What style?' }],
  },
});

describe('sanitizeInlineSvg', () => {
  it('keeps inert SVG presentation markup', () => {
    const out = sanitizeInlineSvg(
      '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M1 1L2 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    );

    expect(out).toContain('<svg');
    expect(out).toContain('<path');
    expect(out).toContain('d="M1 1L2 2"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('viewBox="0 0 24 24"');
  });

  it('removes executable SVG surfaces and external references', () => {
    const out = sanitizeInlineSvg(
      '<svg onload="window.codesign.files.write()"><script>alert(1)</script><foreignObject><button onclick="x()">x</button></foreignObject><a href="javascript:alert(1)"><rect fill="url(https://evil.test/x)"/></a><circle onclick="x()" fill="red"/></svg>',
    );

    expect(out).not.toContain('onload');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('https://evil.test');
    expect(out).toContain('<circle');
  });
});

describe('AskModal queue helpers', () => {
  it('queues concurrent requests without replacing the active request', () => {
    const first = request('ask-1');
    const second = request('ask-2');

    let state = enqueueAskRequest({ active: null, queue: [] }, first);
    state = enqueueAskRequest(state, second);

    expect(state.active?.requestId).toBe('ask-1');
    expect(state.queue.map((item) => item.requestId)).toEqual(['ask-2']);
  });

  it('advances to the next request after the active request resolves', () => {
    const state = {
      active: request('ask-1'),
      queue: [request('ask-2'), request('ask-3')],
    };

    const next = advanceAskQueue(state);

    expect(next.active?.requestId).toBe('ask-2');
    expect(next.queue.map((item) => item.requestId)).toEqual(['ask-3']);
  });
});
