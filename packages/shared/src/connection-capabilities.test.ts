import { describe, expect, it } from 'vitest';
import {
  alternateOpenAiWire,
  type ConnectionCapabilityReason,
  capabilityReason,
  classifyInferenceProbe,
  ensureAllCapabilityLayers,
  hypothesesFromCapabilityReasons,
  modelDiscoveryReason,
  summarizeConnectionCapabilities,
  visibleCapabilityReasons,
} from './connection-capabilities';

function authFail(): ConnectionCapabilityReason {
  return capabilityReason({
    layer: 'authentication',
    status: 'fail',
    category: 'auth',
    cause: 'diagnostics.cause.keyInvalid',
    source: 'shared-contract',
  });
}

function wireFail(suggestedWire: 'openai-chat' | 'openai-responses'): ConnectionCapabilityReason {
  return capabilityReason({
    layer: 'wire-support',
    status: 'fail',
    category: 'wrong-wire',
    cause: 'diagnostics.cause.wireMismatchResponses',
    source: 'probe-only',
    suggestedWire,
  });
}

describe('summarizeConnectionCapabilities', () => {
  it('marks auth failure as incompatible and fills skipped layers', () => {
    const report = summarizeConnectionCapabilities([authFail()]);
    expect(report.compatibility).toBe('incompatible');
    expect(report.reasons).toHaveLength(6);
    expect(report.primary?.layer).toBe('authentication');
    expect(report.reasons.map((r) => r.layer)).toEqual([
      'authentication',
      'endpoint-shape',
      'wire-support',
      'model-discovery',
      'role-compatibility',
      'reasoning-compatibility',
    ]);
  });

  it('marks missing /models + working inference as degraded-compatible', () => {
    const report = summarizeConnectionCapabilities([
      capabilityReason({
        layer: 'authentication',
        status: 'pass',
        category: 'auth',
        cause: 'diagnostics.cause.keyInvalid',
        source: 'shared-contract',
      }),
      capabilityReason({
        layer: 'endpoint-shape',
        status: 'pass',
        category: 'unknown',
        cause: 'diagnostics.cause.unknown',
        source: 'probe-only',
      }),
      capabilityReason({
        layer: 'wire-support',
        status: 'pass',
        category: 'unknown',
        cause: 'diagnostics.cause.unknown',
        source: 'probe-only',
      }),
      modelDiscoveryReason({ modelsAvailable: false, inferenceAlive: true }),
    ]);
    expect(report.compatibility).toBe('degraded-compatible');
    expect(report.primary?.category).toBe('model-discovery-degraded');
    expect(report.primary?.status).toBe('degraded');
  });

  it('marks responses vs chat/completions mismatch as incompatible wire-support', () => {
    const report = summarizeConnectionCapabilities([
      capabilityReason({
        layer: 'authentication',
        status: 'pass',
        category: 'auth',
        cause: 'diagnostics.cause.keyInvalid',
        source: 'shared-contract',
      }),
      wireFail('openai-chat'),
      modelDiscoveryReason({ modelsAvailable: true, inferenceAlive: false }),
    ]);
    expect(report.compatibility).toBe('incompatible');
    expect(report.primary?.layer).toBe('wire-support');
    expect(report.primary?.suggestedWire).toBe('openai-chat');
  });

  it('treats role rejection as degraded-compatible, not a hard fail', () => {
    const report = summarizeConnectionCapabilities([
      capabilityReason({
        layer: 'authentication',
        status: 'pass',
        category: 'auth',
        cause: 'diagnostics.cause.keyInvalid',
        source: 'shared-contract',
      }),
      capabilityReason({
        layer: 'wire-support',
        status: 'pass',
        category: 'unknown',
        cause: 'diagnostics.cause.unknown',
        source: 'probe-only',
      }),
      capabilityReason({
        layer: 'role-compatibility',
        status: 'fail',
        category: 'unsupported-role',
        cause: 'diagnostics.cause.unsupportedRole',
        source: 'probe-only',
      }),
    ]);
    expect(report.compatibility).toBe('degraded-compatible');
    expect(report.primary?.layer).toBe('role-compatibility');
  });
});

describe('classifyInferenceProbe', () => {
  it('classifies 401 as authentication failure', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-chat',
      status: 401,
      bodyText: 'invalid api key',
      developerRoleProbed: false,
    });
    expect(result.authentication).toBe('fail');
    expect(result.wireSupport).toBe('unknown');
    expect(result.tryAlternateWire).toBe(false);
  });

  it('classifies responses 404 as wire mismatch and asks for an alternate probe', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-responses',
      status: 404,
      bodyText: 'not found',
      developerRoleProbed: false,
    });
    expect(result.wireSupport).toBe('fail');
    expect(result.suggestedWire).toBe('openai-chat');
    expect(result.cause).toBe('diagnostics.cause.wireMismatchResponses');
    expect(result.tryAlternateWire).toBe(true);
  });

  it('classifies chat/completions 404 as the inverse wire mismatch', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-chat',
      status: 404,
      bodyText: '',
      developerRoleProbed: false,
    });
    expect(result.cause).toBe('diagnostics.cause.wireMismatchChat');
    expect(result.suggestedWire).toBe('openai-responses');
  });

  it('classifies developer-role rejection without failing the wire', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-chat',
      status: 400,
      bodyText:
        'Invalid input: messages.0.role Input should be system, user, assistant or tool; input "developer"',
      developerRoleProbed: true,
    });
    expect(result.wireSupport).toBe('pass');
    expect(result.roleCompatibility).toBe('fail');
    expect(result.category).toBe('unsupported-role');
  });

  it('classifies unknown-field reasoning errors as reasoning-policy, not a wire fail', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-chat',
      status: 400,
      bodyText: 'Unknown field: reasoning',
      developerRoleProbed: true,
    });
    expect(result.wireSupport).toBe('pass');
    expect(result.reasoningCompatibility).toBe('fail');
    expect(result.cause).toBe('diagnostics.cause.reasoningPolicy');
  });

  it('classifies openai-responses instructions rejection as wire mismatch', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-responses',
      status: 400,
      bodyText: 'Unknown parameter: instructions',
      developerRoleProbed: false,
    });
    expect(result.wireSupport).toBe('fail');
    expect(result.cause).toBe('diagnostics.cause.wireMismatchResponses');
    expect(result.tryAlternateWire).toBe(true);
  });

  it('classifies 501 not-implemented as a wire failure', () => {
    const result = classifyInferenceProbe({
      wire: 'anthropic',
      status: 501,
      bodyText: 'Messages API not implemented',
      developerRoleProbed: false,
    });
    expect(result.wireSupport).toBe('fail');
    expect(result.cause).toBe('diagnostics.cause.gatewayIncompatible');
    expect(result.tryAlternateWire).toBe(false);
  });

  it('treats model_unknown 400 as a live endpoint', () => {
    const result = classifyInferenceProbe({
      wire: 'openai-chat',
      status: 400,
      bodyText: '{"error":{"message":"model_not_found"}}',
      developerRoleProbed: true,
    });
    expect(result.wireSupport).toBe('pass');
    expect(result.authentication).toBe('pass');
    expect(result.roleCompatibility).toBe('pass');
  });
});

describe('hypothesesFromCapabilityReasons', () => {
  it('returns structured hypotheses for visible reasons only', () => {
    const reasons = ensureAllCapabilityLayers([
      authFail(),
      capabilityReason({
        layer: 'wire-support',
        status: 'pass',
        category: 'unknown',
        cause: 'diagnostics.cause.unknown',
        source: 'probe-only',
      }),
    ]);
    const hypotheses = hypothesesFromCapabilityReasons(reasons);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0]?.cause).toBe('diagnostics.cause.keyInvalid');
    expect(hypotheses[0]?.suggestedFix?.kind).toBe('openSettings');
    expect(visibleCapabilityReasons(reasons).map((r) => r.layer)).toEqual(['authentication']);
  });

  it('attaches a switchWire fix for responses vs chat mismatch', () => {
    const hypotheses = hypothesesFromCapabilityReasons([wireFail('openai-chat')]);
    expect(hypotheses[0]?.suggestedFix?.kind).toBe('switchWire');
    expect(hypotheses[0]?.suggestedFix?.wire).toBe('openai-chat');
  });
});

describe('alternateOpenAiWire', () => {
  it('pairs chat and responses, and leaves other wires unpaired', () => {
    expect(alternateOpenAiWire('openai-responses')).toBe('openai-chat');
    expect(alternateOpenAiWire('openai-chat')).toBe('openai-responses');
    expect(alternateOpenAiWire('anthropic')).toBeNull();
    expect(alternateOpenAiWire('openai-codex-responses')).toBeNull();
  });
});
