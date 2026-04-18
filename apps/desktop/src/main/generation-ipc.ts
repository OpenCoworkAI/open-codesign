import { CodesignError } from '@open-codesign/shared';

export interface CancellationLogger {
  info: (event: string, payload: { id: string }) => void;
}

export function cancelGenerationRequest(
  raw: unknown,
  inFlight: Map<string, AbortController>,
  logIpc: CancellationLogger,
): void {
  if (typeof raw !== 'string') {
    throw new CodesignError('cancel-generation expects a generationId string', 'IPC_BAD_INPUT');
  }

  const controller = inFlight.get(raw);
  if (!controller) return;

  controller.abort();
  inFlight.delete(raw);
  logIpc.info('generate.cancelled', { id: raw });
}
