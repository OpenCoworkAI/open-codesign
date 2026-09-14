import type { ModelsProbeRelation } from './base-url';
import type { WireApi } from './config';
import type { DiagnosticCategory } from './diagnostics';

/** Auth shape runtime generate will send for this provider. */
export type InvokeAuthMode = 'codex-oauth' | 'anthropic-oauth' | 'bearer' | 'x-api-key' | 'keyless';

/**
 * Whether a connection probe used the same invoke contract as generate.
 *
 * - `aligned`: the probe used the generate auth/header/baseUrl/wire, and the
 *   inference endpoint either succeeded or was the Codex OAuth path.
 * - `degraded-discovery`: inference works (generate would work) but GET
 *   /models is missing or unusable.
 * - `diverged`: something is reachable (usually GET /models) but the real
 *   inference endpoint used at generate-time failed.
 */
export type InvokeParity = 'aligned' | 'degraded-discovery' | 'diverged';

export type ConnectionProbeMethod =
  | 'models'
  | 'invoke'
  | 'chat_completion_degraded'
  | 'responses_degraded'
  | 'anthropic_messages_degraded'
  | 'codex_oauth';

/**
 * Non-secret snapshot of the contract generate will use. Safe to send to the
 * renderer so Settings can distinguish "host reachable" from "invoke-ready".
 */
export interface InvokeContractView {
  provider: string;
  wire: WireApi;
  canonicalBaseUrl: string;
  invokeUrl: string;
  modelsUrl: string | null;
  modelsProbeRelation: ModelsProbeRelation;
  authMode: InvokeAuthMode;
  allowKeyless: boolean;
}

export interface ConnectionTestResult {
  ok: true;
  /**
   * `models` when GET /models succeeded *and* the invoke probe confirmed the
   * generate path.
   * `invoke` when /models was skipped (unsupported) and the inference
   * endpoint was probed directly.
   * `*_degraded` when /models failed but the wire's real inference endpoint
   * is alive — generate would work.
   * `codex_oauth` when ChatGPT Codex resolved the same refreshable OAuth
   * token generate uses (no /models on this wire).
   */
  probeMethod?: ConnectionProbeMethod;
  compatibility?: 'compatible' | 'degraded';
  reasonCategory?: DiagnosticCategory;
  invokeParity?: InvokeParity;
  modelsProbeRelation?: ModelsProbeRelation;
  invokeContract?: InvokeContractView;
}

export interface ConnectionTestError {
  ok: false;
  code: 'IPC_BAD_INPUT' | '401' | '404' | 'ECONNREFUSED' | 'NETWORK' | 'PARSE' | 'INVOKE_DIVERGED';
  message: string;
  hint: string;
  compatibility?: 'incompatible' | 'diverges';
  reasonCategory?: DiagnosticCategory;
  invokeParity?: InvokeParity;
  modelsProbeRelation?: ModelsProbeRelation;
  /** Present when GET /models succeeded but the generate inference path failed. */
  reachableVia?: 'models';
  probeMethod?: ConnectionProbeMethod;
  invokeContract?: InvokeContractView;
}

export type ConnectionTestResponse = ConnectionTestResult | ConnectionTestError;
