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

export const ModelRef = z.object({
  provider: ProviderId,
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

export const GeneratePayload = z.object({
  prompt: z.string().min(1).max(32_000),
  history: z.array(ChatMessage).max(200),
  model: ModelRef,
  baseUrl: z.string().url().optional(),
  referenceUrl: z.string().url().optional(),
  attachments: z.array(LocalInputFile).max(12).default([]),
  generationId: z.string().optional(),
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
  generationId: z.string().min(1),
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
  generationId: z.string().min(1),
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
  backgroundColor: '#faf8f3',
} as const;

export class CodesignError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'CodesignError';
  }
}

export {
  ConfigSchema,
  PROVIDER_SHORTLIST,
  SUPPORTED_ONBOARDING_PROVIDERS,
  SecretRef,
  STORED_DESIGN_SYSTEM_SCHEMA_VERSION,
  StoredDesignSystem,
  isSupportedOnboardingProvider,
} from './config';
export type {
  Config,
  OnboardingState,
  ProviderShortlist,
  SupportedOnboardingProvider,
} from './config';

export {
  PROXY_PRESET_SCHEMA_VERSION,
  PROXY_PRESETS,
  ProxyPreset,
  ProxyPresetIdSchema,
  getPresetById,
} from './proxy-presets';
export type { ProxyPresetId } from './proxy-presets';
export { DesignTokenV1, DesignTokenSet } from './design-token';
export type { DesignToken } from './design-token';

export { DesignSnapshotV1, DesignV1 } from './snapshot';
export type { Design, DesignSnapshot, SnapshotCreateInput } from './snapshot';
