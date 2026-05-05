import { z } from 'zod';

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

export const ModelRef = z
  .object({
    // v3: providers may be custom ids (`custom-deepseek`, etc.), not just the
    // legacy enum. Keep ProviderId as a documented convenience but let the wire
    // do the dispatch downstream.
    provider: z.string().min(1),
    modelId: z.string(),
  })
  .strict();
export type ModelRef = z.infer<typeof ModelRef>;

export {
  type DesignMdBodySection,
  type DesignMdDocument,
  type DesignMdFinding,
  type DesignMdFindingSeverity,
  formatDesignMdForPrompt,
  parseDesignMd,
  validateDesignMd,
} from './design-md';
export { DEFAULT_SOURCE_ENTRY, LEGACY_SOURCE_ENTRY } from './source-entries';

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

export const ArtifactSourceFormat = z.enum(['jsx', 'html', 'svg', 'markdown']);
export type ArtifactSourceFormat = z.infer<typeof ArtifactSourceFormat>;

export const ArtifactRenderRuntime = z.enum(['react', 'static-html', 'svg', 'none']);
export type ArtifactRenderRuntime = z.infer<typeof ArtifactRenderRuntime>;

export const Artifact = z.object({
  id: z.string(),
  type: ArtifactType,
  title: z.string(),
  content: z.string(),
  designParams: z.array(DesignParam).default([]),
  sourceFormat: ArtifactSourceFormat.optional(),
  renderRuntime: ArtifactRenderRuntime.optional(),
  entryPath: z.string().min(1).optional(),
  createdAt: z.string(),
});
export type Artifact = z.infer<typeof Artifact>;

export const ChatRole = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z
  .object({
    role: ChatRole,
    content: z.string(),
  })
  .strict();
export type ChatMessage = z.infer<typeof ChatMessage>;

export const DesignRunPreferenceMode = z.enum(['yes', 'no', 'auto']);
export type DesignRunPreferenceMode = z.infer<typeof DesignRunPreferenceMode>;
export const DesignRunPreferenceProvenance = z.enum(['explicit', 'inferred', 'default']);
export type DesignRunPreferenceProvenance = z.infer<typeof DesignRunPreferenceProvenance>;
export const DesignRunPreferenceConfidence = z.enum(['high', 'medium', 'low']);
export type DesignRunPreferenceConfidence = z.infer<typeof DesignRunPreferenceConfidence>;
export const DesignRunPreferenceRoutingEntry = z
  .object({
    provenance: DesignRunPreferenceProvenance,
    confidence: DesignRunPreferenceConfidence,
    reason: z.string().optional(),
  })
  .strict();
export type DesignRunPreferenceRoutingEntry = z.infer<typeof DesignRunPreferenceRoutingEntry>;
export const DesignRunPreferenceRouting = z
  .object({
    tweaks: DesignRunPreferenceRoutingEntry.optional(),
    bitmapAssets: DesignRunPreferenceRoutingEntry.optional(),
    reusableSystem: DesignRunPreferenceRoutingEntry.optional(),
    visualDirection: DesignRunPreferenceRoutingEntry.optional(),
  })
  .strict();
export type DesignRunPreferenceRouting = z.infer<typeof DesignRunPreferenceRouting>;

export const DesignRunPreferencesV1 = z
  .object({
    schemaVersion: z.literal(1),
    tweaks: DesignRunPreferenceMode,
    bitmapAssets: DesignRunPreferenceMode,
    reusableSystem: DesignRunPreferenceMode,
    visualDirection: z.enum(['editorial', 'professional', 'bold', 'custom']).optional(),
    routing: DesignRunPreferenceRouting.optional(),
  })
  .strict();
export type DesignRunPreferencesV1 = z.infer<typeof DesignRunPreferencesV1>;

export const LocalInputFile = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
  })
  .strict();
export type LocalInputFile = z.infer<typeof LocalInputFile>;

export const ElementSelectionRect = z
  .object({
    top: z.number(),
    left: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();
export type ElementSelectionRect = z.infer<typeof ElementSelectionRect>;

export const SelectedElement = z
  .object({
    selector: z.string().min(1),
    tag: z.string().min(1),
    outerHTML: z.string(),
    rect: ElementSelectionRect,
  })
  .strict();
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

export const GeneratePayloadV1 = z
  .object({
    schemaVersion: z.literal(1),
    prompt: z.string().min(1).max(32_000),
    history: z.array(ChatMessage).max(200),
    model: ModelRef,
    baseUrl: z.string().url().optional(),
    referenceUrl: z.string().url().optional(),
    attachments: z.array(LocalInputFile).max(12).default([]),
    generationId: GenerationId,
    /** Required in v0.2: every generation belongs to a workspace-backed design. */
    designId: z.string().min(1),
    /** Current design source for this design (if any). Seeded into the
     *  virtual FS at `App.jsx` so the edit tool can view/edit incrementally
     *  instead of always rewriting from scratch. */
    previousSource: z.string().optional(),
  })
  .strict();
export type GeneratePayloadV1 = z.infer<typeof GeneratePayloadV1>;

export const ApplyCommentPayload = z
  .object({
    designId: z.string().min(1),
    artifactSource: z.string().min(1).max(500_000),
    comment: z.string().min(1).max(4_000),
    selection: SelectedElement,
    generationId: GenerationId,
    model: ModelRef.optional(),
    referenceUrl: z.string().url().optional(),
    attachments: z.array(LocalInputFile).max(12).default([]),
  })
  .strict();
export type ApplyCommentPayload = z.infer<typeof ApplyCommentPayload>;

export const CancelGenerationPayloadV1 = z
  .object({
    schemaVersion: z.literal(1),
    generationId: GenerationId,
  })
  .strict();
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

export type { CanonicalWire } from './base-url';
export {
  canonicalBaseUrl,
  ensureVersionedBase,
  modelsEndpointUrl,
  stripInferenceEndpointSuffix,
} from './base-url';
export { CodesignError } from './codesign-error';
export type {
  Config,
  ConfigV3,
  ImageGenerationCredentialMode,
  ImageGenerationOutputFormat,
  ImageGenerationProvider,
  ImageGenerationQuality,
  ImageGenerationSettings,
  ImageGenerationSize,
  OnboardingState,
  ProviderCapabilities,
  ProviderEntry,
  ProviderModelDiscoveryMode,
  ProviderShortlist,
  ReasoningLevel,
  SupportedOnboardingProvider,
  WireApi,
} from './config';
export {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  ConfigSchema,
  ConfigV3Schema,
  defaultProviderCapabilities,
  detectWireFromBaseUrl,
  hydrateConfig,
  IMAGE_GENERATION_SCHEMA_VERSION,
  ImageGenerationCredentialModeSchema,
  ImageGenerationOutputFormatSchema,
  ImageGenerationProviderSchema,
  ImageGenerationQualitySchema,
  ImageGenerationSettingsSchema,
  ImageGenerationSizeSchema,
  isSupportedOnboardingProvider,
  migrateLegacyToV3,
  PROVIDER_SHORTLIST,
  ProviderCapabilitiesSchema,
  ProviderEntrySchema,
  ProviderModelDiscoveryModeSchema,
  parseConfigFlexible,
  ReasoningLevelSchema,
  resolveProviderCapabilities,
  SecretRef,
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  StoredDesignSystem,
  SUPPORTED_ONBOARDING_PROVIDERS,
  toPersistedV3,
  WireApiSchema,
} from './config';
export type { DesignToken } from './design-token';
export { DesignTokenSet, DesignTokenV1 } from './design-token';
export type {
  ClaudeCodeDetectionMeta,
  ClaudeCodeUserType,
  CodexDetectionMeta,
  ExternalConfigsDetection,
  GeminiDetectionMeta,
  OpencodeDetectionMeta,
} from './detection';
export type {
  DiagnoseContext,
  DiagnosticCategory,
  DiagnosticFix,
  DiagnosticFixKind,
  DiagnosticHypothesis,
  DiagnosticSeverity,
  ErrorCode,
  GenerateFailureContext,
} from './diagnostics';
export { diagnose, diagnoseGenerateFailure } from './diagnostics';
export type { CodesignErrorCode } from './error-codes';
export { ERROR_CODE_DESCRIPTIONS, ERROR_CODES } from './error-codes';
// NOTE: fingerprint.ts imports node:crypto and is intentionally NOT re-exported
// from this barrel — it's main-process only. Import from
// '@open-codesign/shared/fingerprint' directly.
export type { FingerprintInput } from './fingerprint';
export type { ProxyPresetId } from './proxy-presets';
export {
  getPresetById,
  PROXY_PRESET_SCHEMA_VERSION,
  PROXY_PRESETS,
  ProxyPreset,
  ProxyPresetIdSchema,
} from './proxy-presets';
export type {
  LastDoneStateV1,
  ResourceManifestEntryV1,
  ResourceManifestV1,
  ResourceStateV1,
  ScaffoldedFileStateV1,
} from './resource-manifest';
export {
  applyToolCallToResourceState,
  createEmptyResourceState,
  deriveResourceStateFromChatRows,
  normalizeResourceState,
  RESOURCE_MANIFEST_SCHEMA_VERSION,
  RESOURCE_STATE_SCHEMA_VERSION,
} from './resource-manifest';
export type { LoadedSkill } from './skills';
export { SkillFrontmatterV1 } from './skills';
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
  CurrentToolNameV1,
  ToolManifestEntryV1,
  ToolManifestIconKeyV1,
  ToolManifestV1,
} from './tool-manifest';
export {
  CURRENT_TOOL_ORDER,
  currentToolManifestEntries,
  getToolManifestEntry,
  isCurrentToolName,
  TOOL_MANIFEST_SCHEMA_VERSION,
  TOOL_MANIFEST_V1,
} from './tool-manifest';

// ---------------------------------------------------------------------------
// Diagnostic events (main-process local design store)
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
 * Persistence into the local diagnostic event store is a nice-to-have enhancement that
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

export type {
  EditmodeBlock,
  EditmodeTokens,
  EditmodeTokenValue,
  TokenSchemaEntry,
  TweakSchema,
} from './editmode';
export {
  ensureEditmodeMarkers,
  normalizeLegacyEditmodeBlock,
  parseEditmodeBlock,
  parseTweakSchema,
  replaceEditmodeBlock,
  replaceTweakSchema,
} from './editmode';
