import { z } from 'zod';

export const WebSearchSettingsState = z
  .object({ enabled: z.boolean(), hasKey: z.boolean() })
  .strict();
export type WebSearchSettingsState = z.infer<typeof WebSearchSettingsState>;

export const SaveWebSearchSettingsInput = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .optional(),
    clearKey: z.boolean().optional(),
  })
  .strict()
  .refine((input) => !(input.clearKey && input.apiKey !== undefined), {
    message: 'Cannot replace and clear a key together',
  });
export type SaveWebSearchSettingsInput = z.infer<typeof SaveWebSearchSettingsInput>;

export const WebSearchTestResult = z
  .object({
    status: z.enum([
      'ok',
      'missing-key',
      'unreadable-key',
      'invalid-key',
      'quota',
      'rate-limit',
      'timeout',
      'network-error',
      'service-error',
      'unexpected-response',
    ]),
    httpStatus: z.number().int().min(100).max(599).optional(),
  })
  .strict();
export type WebSearchTestResult = z.infer<typeof WebSearchTestResult>;

export const WEB_SEARCH_SETTINGS_CHANNELS = {
  get: 'settings:v1:get-web-search',
  save: 'settings:v1:save-web-search',
  test: 'settings:v1:test-web-search',
} as const;
