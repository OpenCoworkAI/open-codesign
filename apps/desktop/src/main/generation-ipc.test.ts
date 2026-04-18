import { CancelGenerationPayloadV1, CodesignError } from '@open-codesign/shared';
import { describe, expect, it, vi } from 'vitest';
import { cancelGenerationRequest } from './generation-ipc';

function makeController() {
  return { abort: vi.fn() } as unknown as AbortController;
}

describe('cancelGenerationRequest', () => {
  it('parses the public v1 cancel-generation payload', () => {
    const payload = CancelGenerationPayloadV1.parse({
      schemaVersion: 1,
      generationId: 'gen-1',
    });

    expect(payload).toEqual({
      schemaVersion: 1,
      generationId: 'gen-1',
    });
  });

  it('throws on invalid IPC payloads without aborting in-flight requests', () => {
    const controller = makeController();
    const inFlight = new Map([['gen-1', controller]]);
    const logIpc = { info: vi.fn() };

    expect(() => cancelGenerationRequest(undefined, inFlight, logIpc)).toThrow(CodesignError);
    expect(controller.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-1')).toBe(true);
    expect(logIpc.info).not.toHaveBeenCalled();
  });

  it('aborts only the requested generation', () => {
    const target = makeController();
    const other = makeController();
    const inFlight = new Map([
      ['gen-1', target],
      ['gen-2', other],
    ]);
    const logIpc = { info: vi.fn() };

    cancelGenerationRequest('gen-1', inFlight, logIpc);

    expect(target.abort).toHaveBeenCalledOnce();
    expect(other.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-1')).toBe(false);
    expect(inFlight.has('gen-2')).toBe(true);
    expect(logIpc.info).toHaveBeenCalledWith('generate.cancelled', { id: 'gen-1' });
  });

  it('is a noop when the generationId is not in the in-flight map', () => {
    const other = makeController();
    const inFlight = new Map([['gen-2', other]]);
    const logIpc = { info: vi.fn() };

    cancelGenerationRequest('gen-unknown', inFlight, logIpc);

    expect(other.abort).not.toHaveBeenCalled();
    expect(inFlight.has('gen-2')).toBe(true);
    expect(logIpc.info).not.toHaveBeenCalled();
  });

  it('rejects CancelGenerationPayloadV1 with empty generationId or missing schemaVersion', () => {
    expect(() => CancelGenerationPayloadV1.parse({ schemaVersion: 1, generationId: '' })).toThrow();
    expect(() => CancelGenerationPayloadV1.parse({ generationId: 'gen-1' })).toThrow();
    expect(() =>
      CancelGenerationPayloadV1.parse({ schemaVersion: 2, generationId: 'gen-1' }),
    ).toThrow();
  });
});
