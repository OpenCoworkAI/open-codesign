import { i18n, initI18n } from '@open-codesign/i18n';
import type { DiagnosticHypothesis } from '@open-codesign/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildGenerateDisplayMessage,
  buildGenerateErrorDescription,
  deriveGenerateHypothesis,
  extractUpstreamContext,
} from './errors';

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

describe('provider recovery hints in generation errors', () => {
  afterEach(async () => {
    await initI18n('en');
  });

  it.each([
    ['en', 'Choose a model that supports the required system and developer message roles.'],
    ['zh-CN', '选择支持所需 system 和 developer 消息角色的模型。'],
    ['es', 'Elige un modelo compatible con los roles de mensaje system y developer requeridos.'],
    [
      'pt-BR',
      'Escolha um modelo compatível com os papéis de mensagem system e developer necessários.',
    ],
  ])('shows the actionable hint in %s', async (locale, hint) => {
    await initI18n(locale);
    const error = Object.assign(new Error('unsupported role: developer'), {
      upstream_recovery_category: 'model_not_supported_role',
      upstream_status: 400,
    });
    const hypothesis = deriveGenerateHypothesis(error, null);
    expect(hypothesis?.recoveryCategory).toBe('model_not_supported_role');
    expect(extractUpstreamContext(error)).toMatchObject({
      upstream_recovery_category: 'model_not_supported_role',
    });
    const description = buildGenerateErrorDescription(error.message, hypothesis);
    expect(description).toContain(error.message);
    expect(description).toContain(hint);
    expect(description).not.toContain('Recovery:');
    expect(description).not.toContain('model_not_supported_role');
    expect(description).not.toContain('diagnostics.recovery.');
  });

  it('shows a recovery-only hint without appending an unknown-cause message', async () => {
    await initI18n('en');
    const error = { upstream_recovery_category: 'network_timeout' };
    const hypothesis = deriveGenerateHypothesis(error, null);
    const description = buildGenerateErrorDescription('fetch failed', hypothesis);
    expect(description).toContain('Check network connectivity');
    expect(description).not.toContain(i18n.t('diagnostics.cause.unknown'));
  });

  it.each([
    'unknown',
    'made_up_category',
    undefined,
  ])('ignores unrecognized category %s', async (category) => {
    await initI18n('en');
    const error = { upstream_recovery_category: category };
    expect(
      buildGenerateErrorDescription('raw failure', deriveGenerateHypothesis(error, null)),
    ).toBe('raw failure');
  });
});
