import { ModelRef, ReasoningLevelSchema, WireApiSchema } from '@open-codesign/shared';
import { z } from 'zod';

const positive = z.number().int().positive();
const target = z.strictObject({
  model: ModelRef.refine(
    (value) => value.provider.trim().length > 0 && value.modelId.trim().length > 0,
  ),
  credentialEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/u),
  contextWindowTokens: positive.max(2097152),
  baseUrl: z
    .string()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, 'URL must be HTTP(S) without credentials, query or fragment')
    .optional(),
  wire: WireApiSchema.optional(),
  reasoning: ReasoningLevelSchema.optional(),
  allowKeyless: z.boolean().default(false),
});
const uniqueStrings = z
  .array(z.string().min(1))
  .min(1)
  .refine((value) => new Set(value).size === value.length)
  .nullable()
  .default(null);
const unconfigured = (role: string) => ({
  model: { provider: 'unconfigured', modelId: `unconfigured-${role}` },
  credentialEnv: 'CODESIGN_RESEARCH_API_KEY',
  contextWindowTokens: 32768,
});
const schema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  models: z.strictObject({ compressor: target, reader: target }).default({
    compressor: { ...unconfigured('compressor'), allowKeyless: false },
    reader: { ...unconfigured('reader'), allowKeyless: false },
  }),
  budgets: z
    .array(z.union([z.literal(2048), z.literal(4096), z.literal(8192)]))
    .min(1)
    .refine((value) => new Set(value).size === value.length)
    .default([2048, 4096, 8192]),
  trials: positive.max(10).default(3),
  maxCalls: z.number().int().nonnegative().max(10000).default(0),
  timeoutMs: positive.max(300000).default(60000),
  maxOutputTokens: positive.max(32768).default(1024),
  summaryMaxBytes: positive.max(65536).default(1800),
  caseIds: uniqueStrings,
  hostCaseIds: uniqueStrings,
  allowEstimatedBudget: z.boolean().default(false),
});
export type UnifiedConfig = z.infer<typeof schema>;
export type UnifiedTarget = UnifiedConfig['models']['reader'];
export function parseUnifiedConfig(value: unknown): UnifiedConfig {
  return schema.parse(value);
}
export function assertExecutableConfig(config: UnifiedConfig): void {
  if (config.maxCalls <= 0) throw new Error('Execution requires an explicit positive maxCalls');
  for (const entry of Object.values(config.models)) {
    if (
      entry.model.provider === 'unconfigured' ||
      entry.model.modelId.startsWith('unconfigured-') ||
      entry.model.provider.startsWith('configure-') ||
      entry.model.modelId.startsWith('configure-')
    )
      throw new Error('Specify exact configured models before execution');
  }
}
