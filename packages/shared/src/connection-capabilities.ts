/**
 * Capability-aware connection diagnostics.
 *
 * Connection tests classify *which layer* is incompatible instead of a single
 * pass/fail. Results are IPC-serializable so the renderer can show structured
 * reasons. Probe-only conclusions are tagged so UI does not treat them as
 * generate-time facts (#213 / #216).
 *
 * Layer order is the product taxonomy from issue #213:
 * authentication → endpoint-shape → wire-support → model-discovery →
 * role-compatibility → reasoning-compatibility.
 */

import type { WireApi } from './config';
import type {
  DiagnosticCategory,
  DiagnosticFix,
  DiagnosticFixKind,
  DiagnosticHypothesis,
  DiagnosticSeverity,
} from './diagnostics';
import {
  looksLikeDeveloperRoleRejection,
  looksLikeGatewayNotImplemented,
  looksLikeReasoningRejection,
  looksLikeResponsesShapeRejection,
} from './diagnostics';

export const CONNECTION_CAPABILITY_LAYERS = [
  'authentication',
  'endpoint-shape',
  'wire-support',
  'model-discovery',
  'role-compatibility',
  'reasoning-compatibility',
] as const;

export type ConnectionCapabilityLayer = (typeof CONNECTION_CAPABILITY_LAYERS)[number];

export type ConnectionCapabilityStatus = 'pass' | 'fail' | 'degraded' | 'skipped' | 'unknown';

/**
 * `degraded-compatible` is the #213 status for “reachable and usable, with a
 * known limitation” (missing `/models`, rejected `developer` role, etc.).
 */
export type ConnectionCompatibility = 'compatible' | 'degraded-compatible' | 'incompatible';

/**
 * `shared-contract` — derived from the same auth/wire/baseUrl the runtime uses.
 * `probe-only` — inferred from a connection probe; must not be treated as a
 * generate-time fact. Compose with a future effective-provider contract (#216)
 * by keeping this field additive rather than baking probe semantics into runtime.
 */
export type CapabilityConclusionSource = 'shared-contract' | 'probe-only';

export interface ConnectionCapabilityReason {
  layer: ConnectionCapabilityLayer;
  status: ConnectionCapabilityStatus;
  category: DiagnosticCategory;
  /** i18n key, e.g. `diagnostics.cause.keyInvalid` */
  cause: string;
  source: CapabilityConclusionSource;
  /** Short English detail for logs/tests; not shown unless the UI opts in. */
  detail?: string;
  suggestedWire?: WireApi;
  suggestedFixKind?: DiagnosticFixKind;
}

export interface ConnectionCapabilityReport {
  compatibility: ConnectionCompatibility;
  reasons: ConnectionCapabilityReason[];
  primary?: ConnectionCapabilityReason;
}

const HARD_FAIL_LAYERS = new Set<ConnectionCapabilityLayer>([
  'authentication',
  'endpoint-shape',
  'wire-support',
]);

export function skippedReason(
  layer: ConnectionCapabilityLayer,
  detail?: string,
): ConnectionCapabilityReason {
  const reason: ConnectionCapabilityReason = {
    layer,
    status: 'skipped',
    category: 'unknown',
    cause: 'diagnostics.cause.capabilitySkipped',
    source: 'probe-only',
  };
  if (detail !== undefined) reason.detail = detail;
  return reason;
}

export function capabilityReason(input: {
  layer: ConnectionCapabilityLayer;
  status: ConnectionCapabilityStatus;
  category: DiagnosticCategory;
  cause: string;
  source: CapabilityConclusionSource;
  detail?: string;
  suggestedWire?: WireApi;
  suggestedFixKind?: DiagnosticFixKind;
}): ConnectionCapabilityReason {
  const reason: ConnectionCapabilityReason = {
    layer: input.layer,
    status: input.status,
    category: input.category,
    cause: input.cause,
    source: input.source,
  };
  if (input.detail !== undefined) reason.detail = input.detail;
  if (input.suggestedWire !== undefined) reason.suggestedWire = input.suggestedWire;
  if (input.suggestedFixKind !== undefined) reason.suggestedFixKind = input.suggestedFixKind;
  return reason;
}

export function ensureAllCapabilityLayers(
  observations: readonly ConnectionCapabilityReason[],
): ConnectionCapabilityReason[] {
  const byLayer = new Map<ConnectionCapabilityLayer, ConnectionCapabilityReason>();
  for (const observation of observations) {
    byLayer.set(observation.layer, observation);
  }
  return CONNECTION_CAPABILITY_LAYERS.map(
    (layer) => byLayer.get(layer) ?? skippedReason(layer, 'Layer was not probed'),
  );
}

function isVisibleReason(reason: ConnectionCapabilityReason): boolean {
  return reason.status === 'fail' || reason.status === 'degraded';
}

export function visibleCapabilityReasons(
  reasons: readonly ConnectionCapabilityReason[],
): ConnectionCapabilityReason[] {
  return reasons.filter(isVisibleReason);
}

function pickPrimary(
  reasons: readonly ConnectionCapabilityReason[],
): ConnectionCapabilityReason | undefined {
  const fails = reasons.filter((reason) => reason.status === 'fail');
  const hard = fails.find((reason) => HARD_FAIL_LAYERS.has(reason.layer));
  if (hard !== undefined) return hard;
  if (fails[0] !== undefined) return fails[0];
  return reasons.find((reason) => reason.status === 'degraded');
}

export function summarizeConnectionCapabilities(
  observations: readonly ConnectionCapabilityReason[],
): ConnectionCapabilityReport {
  const reasons = ensureAllCapabilityLayers(observations);
  const primary = pickPrimary(reasons);
  const hardFail = reasons.find(
    (reason) => HARD_FAIL_LAYERS.has(reason.layer) && reason.status === 'fail',
  );
  if (hardFail !== undefined) {
    return { compatibility: 'incompatible', reasons, primary: hardFail };
  }
  const degradedOrSoftFail = reasons.some(
    (reason) =>
      reason.status === 'degraded' ||
      (reason.status === 'fail' && !HARD_FAIL_LAYERS.has(reason.layer)),
  );
  if (degradedOrSoftFail) {
    return {
      compatibility: 'degraded-compatible',
      reasons,
      ...(primary !== undefined ? { primary } : {}),
    };
  }
  return { compatibility: 'compatible', reasons, ...(primary !== undefined ? { primary } : {}) };
}

export function alternateOpenAiWire(wire: WireApi): 'openai-chat' | 'openai-responses' | null {
  if (wire === 'openai-responses') return 'openai-chat';
  if (wire === 'openai-chat') return 'openai-responses';
  return null;
}

export interface InferenceProbeClassification {
  authentication: 'pass' | 'fail' | 'skipped';
  wireSupport: 'pass' | 'fail' | 'unknown';
  roleCompatibility: 'pass' | 'fail' | 'skipped';
  reasoningCompatibility: 'pass' | 'fail' | 'skipped';
  category: DiagnosticCategory;
  cause: string;
  suggestedWire?: WireApi;
  tryAlternateWire: boolean;
}

/**
 * Classify a single inference-probe HTTP outcome. Network failures are handled
 * by the caller (no status). `developerRoleProbed` records whether the request
 * included a `developer` message — needed to distinguish role pass vs skipped.
 */
export function classifyInferenceProbe(input: {
  wire: WireApi;
  status: number;
  bodyText: string;
  developerRoleProbed: boolean;
  anthropicErrorShape?: boolean;
}): InferenceProbeClassification {
  const bodyText = input.bodyText;
  const status = input.status;

  if (status === 401 || status === 403) {
    return {
      authentication: 'fail',
      wireSupport: 'unknown',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'auth',
      cause: 'diagnostics.cause.keyInvalid',
      tryAlternateWire: false,
    };
  }

  if (
    input.wire === 'anthropic' &&
    status >= 400 &&
    status < 500 &&
    input.anthropicErrorShape !== true
  ) {
    return {
      authentication: 'pass',
      wireSupport: 'fail',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'endpoint-not-found',
      cause: 'diagnostics.cause.endpointNotFound',
      tryAlternateWire: false,
    };
  }

  if (status === 404) {
    const suggested = alternateOpenAiWire(input.wire);
    return {
      authentication: 'pass',
      wireSupport: 'fail',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'wrong-wire',
      cause:
        input.wire === 'openai-responses'
          ? 'diagnostics.cause.wireMismatchResponses'
          : input.wire === 'openai-chat'
            ? 'diagnostics.cause.wireMismatchChat'
            : 'diagnostics.cause.wireUnsupported',
      ...(suggested !== null ? { suggestedWire: suggested } : {}),
      tryAlternateWire: suggested !== null,
    };
  }

  const clientError = status === 400 || status === 422;
  if (clientError && looksLikeDeveloperRoleRejection(bodyText)) {
    return {
      authentication: 'pass',
      wireSupport: 'pass',
      roleCompatibility: 'fail',
      reasoningCompatibility: 'skipped',
      category: 'unsupported-role',
      cause: 'diagnostics.cause.unsupportedRole',
      suggestedWire: 'openai-chat',
      tryAlternateWire: false,
    };
  }

  if (clientError && looksLikeReasoningRejection(bodyText)) {
    return {
      authentication: 'pass',
      wireSupport: 'pass',
      roleCompatibility: input.developerRoleProbed ? 'pass' : 'skipped',
      reasoningCompatibility: 'fail',
      category: 'reasoning-policy',
      cause: 'diagnostics.cause.reasoningPolicy',
      tryAlternateWire: false,
    };
  }

  if (
    (clientError || status === 501 || (status >= 500 && status < 600)) &&
    looksLikeResponsesShapeRejection(bodyText) &&
    input.wire === 'openai-responses'
  ) {
    return {
      authentication: 'pass',
      wireSupport: 'fail',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'wrong-wire',
      cause: 'diagnostics.cause.wireMismatchResponses',
      suggestedWire: 'openai-chat',
      tryAlternateWire: true,
    };
  }

  if (status === 501 || looksLikeGatewayNotImplemented(bodyText)) {
    const suggested = alternateOpenAiWire(input.wire);
    return {
      authentication: 'pass',
      wireSupport: 'fail',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'wrong-wire',
      cause:
        input.wire === 'openai-responses'
          ? 'diagnostics.cause.wireMismatchResponses'
          : input.wire === 'openai-chat'
            ? 'diagnostics.cause.wireMismatchChat'
            : 'diagnostics.cause.gatewayIncompatible',
      ...(suggested !== null ? { suggestedWire: suggested } : {}),
      tryAlternateWire: suggested !== null,
    };
  }

  if (status >= 500) {
    return {
      authentication: 'pass',
      wireSupport: 'fail',
      roleCompatibility: 'skipped',
      reasoningCompatibility: 'skipped',
      category: 'upstream-server-error',
      cause: 'diagnostics.cause.serverError',
      tryAlternateWire: false,
    };
  }

  // 2xx or request-level 4xx (model_unknown, 402, 429, …): route exists.
  return {
    authentication: 'pass',
    wireSupport: 'pass',
    roleCompatibility: input.developerRoleProbed ? 'pass' : 'skipped',
    reasoningCompatibility: 'skipped',
    category: 'unknown',
    cause: 'diagnostics.cause.unknown',
    tryAlternateWire: false,
  };
}

function appendV1(current: string): string {
  const cleaned = current.replace(/\/+$/, '');
  return cleaned.endsWith('/v1') ? cleaned : `${cleaned}/v1`;
}

function fixFromReason(reason: ConnectionCapabilityReason): DiagnosticFix | undefined {
  if (reason.suggestedWire !== undefined) {
    return {
      kind: 'switchWire',
      label: 'diagnostics.fix.switchWire',
      wire: reason.suggestedWire,
    };
  }
  if (reason.suggestedFixKind === 'setReasoning' || reason.category === 'reasoning-policy') {
    return {
      kind: 'setReasoning',
      label: 'diagnostics.fix.disableReasoning',
      reasoningLevel: 'off',
    };
  }
  if (reason.category === 'auth') {
    return {
      kind: 'openSettings',
      label: 'diagnostics.fix.updateKey',
      settingsTab: 'models',
    };
  }
  if (reason.category === 'missing-base-v1') {
    return {
      kind: 'baseUrlTransform',
      label: 'diagnostics.fix.addV1',
      baseUrlTransform: appendV1,
    };
  }
  if (reason.category === 'unsupported-role') {
    return {
      kind: 'switchWire',
      label: 'diagnostics.fix.switchWire',
      wire: 'openai-chat',
    };
  }
  if (reason.category === 'network-unreachable') {
    return {
      kind: 'openSettings',
      label: 'diagnostics.fix.checkNetwork',
    };
  }
  return undefined;
}

function severityForReason(reason: ConnectionCapabilityReason): DiagnosticSeverity {
  if (reason.status === 'fail' && HARD_FAIL_LAYERS.has(reason.layer)) return 'error';
  if (reason.status === 'degraded' || reason.status === 'fail') return 'warning';
  return 'info';
}

/** Map IPC-safe capability reasons onto the hypothesis shape the diagnostic panel already renders. */
export function hypothesesFromCapabilityReasons(
  reasons: readonly ConnectionCapabilityReason[],
): DiagnosticHypothesis[] {
  return visibleCapabilityReasons(reasons).map((reason) => {
    const suggestedFix = fixFromReason(reason);
    const hypothesis: DiagnosticHypothesis = {
      cause: reason.cause,
      category: reason.category,
      severity: severityForReason(reason),
    };
    if (suggestedFix !== undefined) hypothesis.suggestedFix = suggestedFix;
    return hypothesis;
  });
}

export function modelDiscoveryReason(opts: {
  modelsAvailable: boolean;
  inferenceAlive: boolean;
}): ConnectionCapabilityReason {
  if (opts.modelsAvailable) {
    return capabilityReason({
      layer: 'model-discovery',
      status: 'pass',
      category: 'unknown',
      cause: 'diagnostics.cause.modelDiscoveryOk',
      source: 'probe-only',
      detail: 'GET /models succeeded',
    });
  }
  if (opts.inferenceAlive) {
    return capabilityReason({
      layer: 'model-discovery',
      status: 'degraded',
      category: 'model-discovery-degraded',
      cause: 'diagnostics.cause.modelDiscoveryDegraded',
      source: 'probe-only',
      detail: 'GET /models missing; selected-wire inference is reachable',
    });
  }
  return capabilityReason({
    layer: 'model-discovery',
    status: 'fail',
    category: 'endpoint-not-found',
    cause: 'diagnostics.cause.endpointNotFound',
    source: 'probe-only',
    detail: 'GET /models failed and inference was not confirmed',
  });
}
