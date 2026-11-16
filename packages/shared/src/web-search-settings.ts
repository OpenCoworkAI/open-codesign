import { z } from 'zod';
import { WebSearchBackendSchema, WebSearchServiceSchema } from './web-search-routing';

/**
 * Renderer-facing view of the web-search settings. Strict, and deliberately
 * free of any credential material: only boolean "has a key" summaries cross
 * the IPC boundary.
 *
 * Every routing field is OPTIONAL so that older callers/tests that assert an
 * exact `{ enabled, hasKey }` shape keep passing, and so an old main process
 * talking to a new renderer (or vice versa) degrades instead of failing.
 */
export const WebSearchSettingsState = z
  .object({
    enabled: z.boolean(),
    hasKey: z.boolean(),
    backend: WebSearchBackendSchema.optional(),
    nativeEnabled: z.boolean().optional(),
    maxNativeRequests: z.number().int().min(1).max(50).optional(),
    service: WebSearchServiceSchema.optional(),
    mode: z.enum(['search-api', 'native-tool']).optional(),
    unavailableReason: z
      .enum(['missing-key', 'unsupported-provider', 'native-disabled', 'unsupported-model'])
      .optional(),
    /** True when the active provider's own credential is reused for search. */
    inheritsCredential: z.boolean().optional(),
  })
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
    backend: WebSearchBackendSchema.optional(),
    nativeEnabled: z.boolean().optional(),
    maxNativeRequests: z.number().int().min(1).max(50).optional(),
  })
  .strict()
  .refine((input) => !(input.clearKey && input.apiKey !== undefined), {
    message: 'Cannot replace and clear a key together',
  });
export type SaveWebSearchSettingsInput = z.infer<typeof SaveWebSearchSettingsInput>;

/** Plain results preserve error codes through both Electron IPC and contextBridge. */
export type SaveWebSearchSettingsResult =
  | { ok: true; settings: WebSearchSettingsState }
  | { ok: false; code: 'KEYCHAIN_UNAVAILABLE' | 'IPC_BAD_INPUT' | 'WEB_SEARCH_SAVE_FAILED' };

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
      // Routing-level outcomes: no request was attempted because the
      // configuration cannot reach a search capability.
      'unsupported-provider',
      'unsupported-model',
      'native-disabled',
      // A request was attempted but proves nothing either way (e.g. the
      // provider's search API has no cheap health probe).
      'not-verified',
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
