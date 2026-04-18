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

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  provider: ProviderIdEnum,
  modelPrimary: z.string().min(1),
  modelFast: z.string().min(1),
  secrets: z.record(ProviderIdEnum, SecretRef).default({}),
  baseUrls: z.record(ProviderIdEnum, BaseUrlRef).default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

export interface OnboardingState {
  hasKey: boolean;
  provider: SupportedOnboardingProvider | null;
  modelPrimary: string | null;
  modelFast: string | null;
  baseUrl: string | null;
}

export interface ProviderShortlist {
  provider: SupportedOnboardingProvider;
  label: string;
  keyHelpUrl: string;
  primary: string[];
  fast: string[];
  defaultPrimary: string;
  defaultFast: string;
}

export const PROVIDER_SHORTLIST: Record<SupportedOnboardingProvider, ProviderShortlist> = {
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic Claude',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    primary: ['claude-sonnet-4-6', 'claude-opus-4-1'],
    fast: ['claude-haiku-3', 'claude-sonnet-4-6'],
    defaultPrimary: 'claude-sonnet-4-6',
    defaultFast: 'claude-haiku-3',
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    primary: ['gpt-4o', 'gpt-4.1'],
    fast: ['gpt-4o-mini', 'gpt-4.1-mini'],
    defaultPrimary: 'gpt-4o',
    defaultFast: 'gpt-4o-mini',
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyHelpUrl: 'https://openrouter.ai/keys',
    primary: ['anthropic/claude-sonnet-4.6', 'openai/gpt-4o'],
    fast: ['anthropic/claude-haiku-3', 'openai/gpt-4o-mini'],
    defaultPrimary: 'anthropic/claude-sonnet-4.6',
    defaultFast: 'anthropic/claude-haiku-3',
  },
};

export function isSupportedOnboardingProvider(p: string): p is SupportedOnboardingProvider {
  return (SUPPORTED_ONBOARDING_PROVIDERS as readonly string[]).includes(p);
}
