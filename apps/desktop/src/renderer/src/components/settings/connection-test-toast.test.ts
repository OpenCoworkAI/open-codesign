import { describe, expect, it } from 'vitest';
import { connectionTestToastKind } from './connection-test-toast';

describe('connectionTestToastKind', () => {
  it('treats a fully aligned probe as Connection OK', () => {
    expect(
      connectionTestToastKind({
        ok: true,
        compatibility: 'compatible',
        invokeParity: 'aligned',
        probeMethod: 'models',
      }),
    ).toBe('ok');
  });

  it('treats missing /models with working invoke as degraded, not failed', () => {
    expect(
      connectionTestToastKind({
        ok: true,
        compatibility: 'degraded',
        invokeParity: 'degraded-discovery',
        probeMethod: 'chat_completion_degraded',
        reasonCategory: 'model-discovery-degraded',
      }),
    ).toBe('degraded');
  });

  it('distinguishes reachable-but-diverges-from-invoke from a hard failure', () => {
    expect(
      connectionTestToastKind({
        ok: false,
        code: 'INVOKE_DIVERGED',
        message: 'HTTP 404',
        hint: 'The /models endpoint is reachable, but the inference endpoint used at generate-time failed.',
        compatibility: 'diverges',
        invokeParity: 'diverged',
        reachableVia: 'models',
        reasonCategory: 'invoke-contract-diverged',
      }),
    ).toBe('diverges');
    expect(
      connectionTestToastKind({
        ok: false,
        code: '401',
        message: 'HTTP 401',
        hint: 'API key 错误或权限不足',
        compatibility: 'incompatible',
      }),
    ).toBe('failed');
  });
});
