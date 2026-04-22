import { z } from 'zod';
import type { CodesignErrorCode } from './error-codes';

export const ProviderId = z.enum([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'cerebras',
  'xai',
  'mistral',
  'amazon-bedrock',
  'azure-openai-responses',
  'vercel-ai-gateway',
]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ModelRef = z.object({
  // v3: providers may be custom ids (`custom-deepseek`, etc.), not just the
  // legacy enum. Keep ProviderId as a documented convenience but let the wire
  // do the dispatch downstream.
  provider: z.string().min(1),
  modelId: z.string(),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const DesignParam = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.literal('color'),
    cssVar: z.string(),
    defaultValue: z.string(),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.literal('range'),
    cssVar: z.string(),
    defaultValue: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    unit: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.literal('select'),
    cssVar: z.string(),
    defaultValue: z.string(),
    options: z.array(z.string()),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    type: z.literal('toggle'),
    cssVar: z.string(),
    defaultValue: z.enum(['on', 'off']),
  }),
]);
export type DesignParam = z.infer<typeof DesignParam>;

export const ArtifactType = z.enum(['html', 'svg', 'slides', 'bundle']);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const Artifact = z.object({
  id: z.string(),
  type: ArtifactType,
  title: z.string(),
  content: z.string(),
  designParams: z.array(DesignParam).default([]),
  createdAt: z.string(),
});
export type Artifact = z.infer<typeof Artifact>;

export const ChatRole = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z.object({
  role: ChatRole,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const LocalInputFile = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
});
export type LocalInputFile = z.infer<typeof LocalInputFile>;

export const ElementSelectionRect = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ElementSelectionRect = z.infer<typeof ElementSelectionRect>;

export const SelectedElement = z.object({
  selector: z.string().min(1),
  tag: z.string().min(1),
  outerHTML: z.string(),
  rect: ElementSelectionRect,
});
export type SelectedElement = z.infer<typeof SelectedElement>;

// Correlates renderer/main/core log lines for a single generation. Constrained
// to alphanumerics + `_`/`-` so it cannot carry LF/CR into a log line (defense
// in depth — log formatting also escapes, but belt-and-braces for payloads
// that become `runId` fields via AsyncLocalStorage).
const GenerationId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'generationId must be alphanumeric, _ or -');

export const GeneratePayload = z.object({
  prompt: z.string().min(1).max(32_000),
  history: z.array(ChatMessage).max(200),
  model: ModelRef,
  baseUrl: z.string().url().optional(),
  referenceUrl: z.string().url().optional(),
  attachments: z.array(LocalInputFile).max(12).default([]),
  generationId: GenerationId.optional(),
});
export type GeneratePayload = z.infer<typeof GeneratePayload>;

/** @deprecated Use GeneratePayloadV1. */
export type LegacyGeneratePayload = GeneratePayload;

export const GeneratePayloadV1 = z.object({
  schemaVersion: z.literal(1),
  prompt: z.string().min(1).max(32_000),
  history: z.array(ChatMessage).max(200),
  model: ModelRef,
  baseUrl: z.string().url().optional(),
  referenceUrl: z.string().url().optional(),
  attachments: z.array(LocalInputFile).max(12).default([]),
  generationId: GenerationId,
  /** Optional so older clients / tests that don't set it still parse.
   *  Present in the renderer path so agent stream events can route to
   *  the right design's chat bubble. */
  designId: z.string().min(1).optional(),
  /** Current HTML for this design (if any). Seeded into the agent's
   *  virtual FS as `index.html` so the text_editor tool can view/edit
   *  incrementally instead of always rewriting from scratch. */
  previousHtml: z.string().optional(),
});
export type GeneratePayloadV1 = z.infer<typeof GeneratePayloadV1>;

export const ApplyCommentPayload = z.object({
  html: z.string().min(1).max(500_000),
  comment: z.string().min(1).max(4_000),
  selection: SelectedElement,
  model: ModelRef.optional(),
  referenceUrl: z.string().url().optional(),
  attachments: z.array(LocalInputFile).max(12).default([]),
});
export type ApplyCommentPayload = z.infer<typeof ApplyCommentPayload>;

export const CancelGenerationPayloadV1 = z.object({
  schemaVersion: z.literal(1),
  generationId: GenerationId,
});
export type CancelGenerationPayloadV1 = z.infer<typeof CancelGenerationPayloadV1>;

/**
 * Iframe runtime error event — schema for the postMessage payload sent by
 * the sandbox overlay (see packages/runtime/src/overlay.ts) when JS inside
 * the preview throws or rejects unhandled.
 */
export const IframeErrorEvent = z.object({
  __codesign: z.literal(true),
  type: z.literal('IFRAME_ERROR'),
  kind: z.enum(['error', 'unhandledrejection']),
  message: z.string(),
  source: z.string().optional(),
  lineno: z.number().optional(),
  colno: z.number().optional(),
  stack: z.string().optional(),
  timestamp: z.number(),
});
export type IframeErrorEvent = z.infer<typeof IframeErrorEvent>;

export const BRAND = {
  appName: 'Open CoDesign',
  backgroundColor: '#faf8f3',
} as const;

export const PROJECT_SCHEMA_VERSION = 1 as const;

export const ProjectType = z.enum(['prototype', 'slideDeck', 'template', 'other']);
export type ProjectType = z.infer<typeof ProjectType>;

export const ProjectFidelity = z.enum(['wireframe', 'highFidelity']);
export type ProjectFidelity = z.infer<typeof ProjectFidelity>;

export const Project = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  type: ProjectType,
  createdAt: z.string(),
  updatedAt: z.string(),
  fidelity: ProjectFidelity.optional(),
  speakerNotes: z.boolean().optional(),
  templateId: z.string().optional(),
});
export type Project = z.infer<typeof Project>;

export const ProjectDraft = z.object({
  name: z.string().min(1),
  type: ProjectType,
  fidelity: ProjectFidelity.optional(),
  speakerNotes: z.boolean().optional(),
  templateId: z.string().optional(),
});
export type ProjectDraft = z.infer<typeof ProjectDraft>;

export class CodesignError extends Error {
  constructor(
    message: string,
    // Accept a known registry code (preferred) or a free-form string (backward compat).
    public readonly code: CodesignErrorCode | string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CodesignError';
  }
}

export {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  ConfigSchema,
  ConfigV3Schema,
  PROVIDER_SHORTLIST,
  ProviderEntrySchema,
  ReasoningLevelSchema,
  SUPPORTED_ONBOARDING_PROVIDERS,
  SecretRef,
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  StoredDesignSystem,
  WireApiSchema,
  detectWireFromBaseUrl,
  hydrateConfig,
  isSupportedOnboardingProvider,
  migrateLegacyToV3,
  parseConfigFlexible,
  toPersistedV3,
} from './config';
export type {
  Config,
  ConfigV3,
  OnboardingState,
  ProviderEntry,
  ProviderShortlist,
  ReasoningLevel,
  SupportedOnboardingProvider,
  WireApi,
} from './config';

export type {
  ClaudeCodeDetectionMeta,
  ClaudeCodeUserType,
  CodexDetectionMeta,
  ExternalConfigsDetection,
  GeminiDetectionMeta,
  OpencodeDetectionMeta,
} from './detection';

export {
  PROXY_PRESET_SCHEMA_VERSION,
  PROXY_PRESETS,
  ProxyPreset,
  ProxyPresetIdSchema,
  getPresetById,
} from './proxy-presets';
export type { ProxyPresetId } from './proxy-presets';

export {
  canonicalBaseUrl,
  ensureVersionedBase,
  modelsEndpointUrl,
  stripInferenceEndpointSuffix,
} from './base-url';
export type { CanonicalWire } from './base-url';

export { DesignTokenV1, DesignTokenSet } from './design-token';
export type { DesignToken } from './design-token';

export {
  ChatMessageKind,
  ChatMessageRowV1,
  CommentKind,
  CommentRect,
  CommentRowV1,
  CommentStatus,
  DesignFileV1,
  DesignMessageV1,
  DesignSnapshotV1,
  DesignV1,
} from './snapshot';
export type {
  ChatAppendInput,
  ChatArtifactDeliveredPayload,
  ChatAssistantTextPayload,
  ChatErrorPayload,
  ChatMessageRow,
  ChatToolCallPayload,
  ChatUserPayload,
  CommentCreateInput,
  CommentRow,
  CommentScope,
  CommentUpdateInput,
  Design,
  DesignFile,
  DesignMessage,
  DesignSnapshot,
  SnapshotCreateInput,
} from './snapshot';

export { SkillFrontmatterV1 } from './skills';
export type { LoadedSkill } from './skills';

export { diagnose } from './diagnostics';
export type {
  DiagnosticHypothesis,
  DiagnosticFix,
  DiagnoseContext,
  ErrorCode,
} from './diagnostics';

export { ERROR_CODES, ERROR_CODE_DESCRIPTIONS } from './error-codes';
export type { CodesignErrorCode } from './error-codes';
// NOTE: fingerprint.ts imports node:crypto and is intentionally NOT re-exported
// from this barrel — it's main-process only. Import from
// '@open-codesign/shared/fingerprint' directly.
export type { FingerprintInput } from './fingerprint';

// ---------------------------------------------------------------------------
// Diagnostic events (PR3 — main-process diagnostic_events table)
// ---------------------------------------------------------------------------

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEventInput {
  level: DiagnosticLevel;
  code: string;
  scope: string;
  runId: string | undefined;
  fingerprint: string;
  message: string;
  stack: string | undefined;
  transient: boolean;
  /**
   * Arbitrary JSON-serializable payload attached to the event — typically the
   * `NormalizedProviderError` from `retry.ts` (upstream_status, request_id,
   * retry_count, redacted_body_head). Stored as JSON TEXT in the
   * `context_json` column so the Report dialog can render structured fields
   * without reparsing main.log.
   */
  context?: Record<string, unknown>;
}

export interface DiagnosticEventRow {
  id: number;
  schemaVersion: 1;
  ts: number;
  level: DiagnosticLevel;
  code: string;
  scope: string;
  runId: string | undefined;
  fingerprint: string;
  message: string;
  stack: string | undefined;
  transient: boolean;
  count: number;
  /** Parsed JSON from the `context_json` column. May be undefined. */
  context: Record<string, unknown> | undefined;
}

/**
 * Ring-buffered record of a recent renderer-side user action, used to help
 * triage a bug report. Entries should avoid raw prompt text, file paths, and
 * URLs by convention. Redaction is enforced at the summary composer, not at
 * construction, so callers must still rely on the composer's redaction passes.
 */
export interface ActionTimelineEntry {
  ts: number;
  type:
    | 'prompt.submit'
    | 'prompt.cancel'
    | 'prompt.retry'
    | 'provider.switch'
    | 'skill.toggle'
    | 'design.open'
    | 'design.export'
    | 'connection.test'
    | 'onboarding.complete';
  data?: Record<string, unknown>;
}

export interface ListEventsInput {
  schemaVersion: 1;
  limit?: number;
  includeTransient?: boolean;
}

export interface ListEventsResult {
  schemaVersion: 1;
  events: DiagnosticEventRow[];
  /**
   * False when `safeInitSnapshotsDb` failed at boot and the main process has no
   * diagnostics DB. Lets the panel distinguish "no events yet" from "errors are
   * being dropped on the floor" — see FIX-9.
   */
  dbAvailable: boolean;
}

/**
 * Always-reportable error record. Constructed synchronously in the renderer
 * at the moment an error is surfaced to the user (toast, ErrorBoundary,
 * async rejection). The `localId` is the canonical handle — the Report
 * dialog opens purely from in-memory state so Report works even when the
 * DB is unavailable or the event was never persisted.
 *
 * Persistence into `diagnostic_events` is a nice-to-have enhancement that
 * runs fire-and-forget from `createReportableError`. If it succeeds, the
 * caller patches `persistedEventId` / `persistedFingerprint` onto the
 * in-memory record. Nothing downstream depends on that.
 */
export interface ReportableError {
  /** Client-side id — stable across the app lifetime, no DB required. */
  localId: string;
  /** CodesignError code / err.name / 'RENDERER_ERROR' default. */
  code: string;
  /** 'generate' / 'apply-comment' / 'title' / 'onboarding' / 'settings' / etc. */
  scope: string;
  /** Human-readable message. */
  message: string;
  /** Stack if an Error instance had one. */
  stack?: string;
  /** Correlation id when known (generationId for gen paths). */
  runId?: string;
  /** Optional structured payload — normalized provider error, design-system
   *  scan stats, whatever the caller has handy. Arbitrary JSON-safe object. */
  context?: Record<string, unknown>;
  /** SHA / FNV fingerprint — computed client-side so Report works without DB. */
  fingerprint: string;
  /** Unix ms at creation. */
  ts: number;
  /** If DB persistence succeeded (nice-to-have), caller patches this after the
   *  fire-and-forget IPC completes. NOT required for Report to work. */
  persistedEventId?: number;
  /** Mirrors persistedEventId — the SHA1 fingerprint from the DB row. */
  persistedFingerprint?: string;
}

export interface ReportEventInput {
  schemaVersion: 1;
  /** The full ReportableError payload — Report works from in-memory data alone,
   *  no DB lookup required. */
  error: ReportableError;
  includePromptText: boolean;
  includePaths: boolean;
  includeUrls: boolean;
  includeTimeline: boolean;
  notes: string;
  timeline: ActionTimelineEntry[];
}

export interface ReportEventResult {
  schemaVersion: 1;
  issueUrl: string;
  bundlePath: string;
  summaryMarkdown: string;
}

/**
 * Result of `diagnostics:v1:recordRendererError`.
 *
 * `fingerprint` is the main-recomputed fingerprint stored on the DB row (or
 * the in-flight fingerprint when db is unavailable). Renderer patches both
 * `persistedEventId` and `persistedFingerprint` onto the in-memory
 * ReportableError record after the fire-and-forget settles, so Report's
 * dedup lookup uses the canonical main-side value instead of the
 * client-side estimate.
 */
export interface RecordRendererErrorResult {
  schemaVersion: 1;
  eventId: number | null;
  fingerprint: string | null;
}

export {
  ensureEditmodeMarkers,
  parseEditmodeBlock,
  parseTweakSchema,
  replaceEditmodeBlock,
  replaceTweakSchema,
} from './editmode';
export type { EditmodeBlock, TokenSchemaEntry, TweakSchema } from './editmode';
