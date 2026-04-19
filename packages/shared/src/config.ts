import { z } from 'zod';

const ProviderIdEnum = z.enum([
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

export const SUPPORTED_ONBOARDING_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type SupportedOnboardingProvider = (typeof SUPPORTED_ONBOARDING_PROVIDERS)[number];

export const SecretRef = z.object({
  ciphertext: z.string().min(1),
});
export type SecretRef = z.infer<typeof SecretRef>;

export const BaseUrlRef = z.object({
  baseUrl: z.string().url(),
});
export type BaseUrlRef = z.infer<typeof BaseUrlRef>;

export const STORED_DESIGN_SYSTEM_SCHEMA_VERSION = 1 as const;

const StoredDesignSystemShape = z.object({
  schemaVersion: z.literal(STORED_DESIGN_SYSTEM_SCHEMA_VERSION),
  rootPath: z.string().min(1),
  summary: z.string().min(1),
  extractedAt: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)).max(24).default([]),
  colors: z.array(z.string().min(1)).max(24).default([]),
  fonts: z.array(z.string().min(1)).max(16).default([]),
  spacing: z.array(z.string().min(1)).max(16).default([]),
  radius: z.array(z.string().min(1)).max(16).default([]),
  shadows: z.array(z.string().min(1)).max(16).default([]),
});

export const StoredDesignSystem = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  if ('schemaVersion' in record) return record;
  return { schemaVersion: STORED_DESIGN_SYSTEM_SCHEMA_VERSION, ...record };
}, StoredDesignSystemShape);
export type StoredDesignSystem = z.infer<typeof StoredDesignSystem>;

export const ConfigSchema = z.object({
  // Bumped to 2 when we removed the separate `modelFast` slot. v1 configs are
  // accepted (modelFast is treated as optional and dropped on next write).
  version: z
    .union([z.literal(1), z.literal(2)])
    .default(2)
    .transform(() => 2 as const),
  provider: ProviderIdEnum,
  modelPrimary: z.string(),
  /** @deprecated v1-only legacy field; ignored on read, never written in v2. */
  modelFast: z.string().optional(),
  secrets: z.record(ProviderIdEnum, SecretRef).default({}),
  baseUrls: z.record(ProviderIdEnum, BaseUrlRef).default({}),
  designSystem: StoredDesignSystem.optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export interface OnboardingState {
  hasKey: boolean;
  provider: SupportedOnboardingProvider | null;
  modelPrimary: string | null;
  baseUrl: string | null;
  designSystem: StoredDesignSystem | null;
}

export interface ProviderShortlist {
  provider: SupportedOnboardingProvider;
  label: string;
  keyHelpUrl: string;
  primary: string[];
  defaultPrimary: string;
}

export const PROVIDER_SHORTLIST: Record<SupportedOnboardingProvider, ProviderShortlist> = {
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic Claude',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    primary: ['claude-sonnet-4-6', 'claude-opus-4-1'],
    defaultPrimary: 'claude-sonnet-4-6',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    primary: ['gpt-4o', 'gpt-4.1'],
    defaultPrimary: 'gpt-4o',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyHelpUrl: 'https://openrouter.ai/keys',
    primary: ['anthropic/claude-sonnet-4.6', 'openai/gpt-4o'],
    defaultPrimary: 'anthropic/claude-sonnet-4.6',
  },
};

export function isSupportedOnboardingProvider(p: string): p is SupportedOnboardingProvider {
  return (SUPPORTED_ONBOARDING_PROVIDERS as readonly string[]).includes(p);
}
