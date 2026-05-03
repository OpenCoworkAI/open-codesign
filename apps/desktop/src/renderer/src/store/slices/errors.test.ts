import { initI18n } from '@open-codesign/i18n';
import type { DiagnosticHypothesis } from '@open-codesign/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGenerateDisplayMessage } from './errors';

const transportHypothesis: DiagnosticHypothesis = {
  cause: 'diagnostics.cause.transportInterrupted',
  category: 'transport-interrupted',
  severity: 'warning',
};

describe('buildGenerateDisplayMessage', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  it('rewrites the exact opaque IPC terminated error from #189', () => {
    // Regression for the Electron IPC wrapper plus CodesignError shape reported in #189.
    const message =
      "Error invoking remote method 'codesign:v1:generate': CodesignError: terminated";

    expect(buildGenerateDisplayMessage(message, transportHypothesis)).toBe(
      [
        'The provider connection ended before the turn completed. This is usually a gateway timeout or network interruption.',
        '',
        'Technical detail: terminated',
      ].join('\n'),
    );
  });

  it('preserves specific transport messages that already explain what happened', () => {
    const message = 'Upstream proxy aborted the response';

    expect(buildGenerateDisplayMessage(message, transportHypothesis)).toBe(message);
  });

  it('preserves cleaned provider messages when no transport diagnosis exists', () => {
    const message =
      "Error invoking remote method 'codesign:v1:generate': CodesignError: model missing";

    expect(buildGenerateDisplayMessage(message, undefined)).toBe('model missing');
  });
});
