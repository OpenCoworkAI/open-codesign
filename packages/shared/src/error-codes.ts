/**
 * Central registry of CodesignError codes used throughout the app.
 *
 * Keeping them in one place lets us:
 *  - get TS auto-complete when throwing (via ErrorCode union)
 *  - attach a user-facing message and category to every code for diagnostic UI
 *
 * Adding a new code: add one line to ERROR_CODES, then one entry in
 * ERROR_CODE_DESCRIPTIONS. CI (typecheck) will tell you if the latter is
 * missing a key.
 */

export const ERROR_CODES = {
  // IPC validation
  IPC_BAD_INPUT: 'IPC_BAD_INPUT',
  IPC_DB_ERROR: 'IPC_DB_ERROR',
  IPC_NOT_FOUND: 'IPC_NOT_FOUND',

  // Provider / network
  PROVIDER_AUTH_MISSING: 'PROVIDER_AUTH_MISSING',
  PROVIDER_KEY_MISSING: 'PROVIDER_KEY_MISSING',
  PROVIDER_ACTIVE_MISSING_KEY: 'PROVIDER_ACTIVE_MISSING_KEY',
  PROVIDER_NOT_SUPPORTED: 'PROVIDER_NOT_SUPPORTED',
  PROVIDER_MODEL_UNKNOWN: 'PROVIDER_MODEL_UNKNOWN',
  PROVIDER_BASE_URL_MISSING: 'PROVIDER_BASE_URL_MISSING',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_HTTP_4XX: 'PROVIDER_HTTP_4XX',
  PROVIDER_UPSTREAM_ERROR: 'PROVIDER_UPSTREAM_ERROR',
  PROVIDER_ABORTED: 'PROVIDER_ABORTED',
  PROVIDER_RETRY_EXHAUSTED: 'PROVIDER_RETRY_EXHAUSTED',
  CLAUDE_CODE_OAUTH_ONLY: 'CLAUDE_CODE_OAUTH_ONLY',
  CODEX_TOKEN_PARSE_FAILED: 'CODEX_TOKEN_PARSE_FAILED',
  CODEX_TOKEN_NOT_LOGGED_IN: 'CODEX_TOKEN_NOT_LOGGED_IN',

  // Generation / input
  INPUT_EMPTY_PROMPT: 'INPUT_EMPTY_PROMPT',
  INPUT_EMPTY_COMMENT: 'INPUT_EMPTY_COMMENT',
  INPUT_EMPTY_HTML: 'INPUT_EMPTY_HTML',
  INPUT_UNSUPPORTED_MODE: 'INPUT_UNSUPPORTED_MODE',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',

  // Config
  CONFIG_READ_FAILED: 'CONFIG_READ_FAILED',
  CONFIG_PARSE_FAILED: 'CONFIG_PARSE_FAILED',
  CONFIG_SCHEMA_INVALID: 'CONFIG_SCHEMA_INVALID',
  CONFIG_NOT_LOADED: 'CONFIG_NOT_LOADED',
  CONFIG_MISSING: 'CONFIG_MISSING',

  // Snapshot / design DB
  SNAPSHOTS_UNAVAILABLE: 'SNAPSHOTS_UNAVAILABLE',

  // Storage settings (user-data relocation)
  BOOT_ORDER: 'BOOT_ORDER',
  STORAGE_SETTINGS_READ_FAILED: 'STORAGE_SETTINGS_READ_FAILED',
  STORAGE_SETTINGS_PARSE_FAILED: 'STORAGE_SETTINGS_PARSE_FAILED',
  STORAGE_SETTINGS_INVALID: 'STORAGE_SETTINGS_INVALID',

  // Keychain (safeStorage)
  KEYCHAIN_UNAVAILABLE: 'KEYCHAIN_UNAVAILABLE',
  KEYCHAIN_EMPTY_INPUT: 'KEYCHAIN_EMPTY_INPUT',

  // Attachments / reference URL
  ATTACHMENT_TOO_LARGE: 'ATTACHMENT_TOO_LARGE',
  ATTACHMENT_READ_FAILED: 'ATTACHMENT_READ_FAILED',
  REFERENCE_URL_TOO_LARGE: 'REFERENCE_URL_TOO_LARGE',
  REFERENCE_URL_FETCH_FAILED: 'REFERENCE_URL_FETCH_FAILED',
  REFERENCE_URL_FETCH_TIMEOUT: 'REFERENCE_URL_FETCH_TIMEOUT',
  REFERENCE_URL_UNSUPPORTED: 'REFERENCE_URL_UNSUPPORTED',

  // Preferences
  PREFERENCES_READ_FAIL: 'PREFERENCES_READ_FAIL',
  PREFERENCES_INVALID_TIMEOUT: 'PREFERENCES_INVALID_TIMEOUT',

  // Skills
  SKILL_LOAD_FAILED: 'SKILL_LOAD_FAILED',

  // Exporters
  EXPORTER_UNKNOWN: 'EXPORTER_UNKNOWN',
  EXPORTER_NO_CHROME: 'EXPORTER_NO_CHROME',
  EXPORTER_PDF_FAILED: 'EXPORTER_PDF_FAILED',
  EXPORTER_PPTX_FAILED: 'EXPORTER_PPTX_FAILED',
  EXPORTER_ZIP_UNSAFE_PATH: 'EXPORTER_ZIP_UNSAFE_PATH',
  EXPORTER_ZIP_FAILED: 'EXPORTER_ZIP_FAILED',

  // Misc / shell
  OPEN_PATH_FAILED: 'OPEN_PATH_FAILED',

  // Diagnostic events (renderer-origin errors relayed to main)
  RENDERER_ERROR: 'RENDERER_ERROR',
} as const;

/** Literal union of every known CodesignError code. */
export type CodesignErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

type ErrorCodeDescription = {
  /** @deprecated use userFacingKey + i18n lookup. Kept for backward compatibility. */
  userFacing: string;
  userFacingKey: string;
  category: 'ipc' | 'provider' | 'generation' | 'snapshot' | 'preferences' | 'connection' | 'other';
};

export const ERROR_CODE_DESCRIPTIONS: Record<CodesignErrorCode, ErrorCodeDescription> = {
  // IPC validation
  IPC_BAD_INPUT: {
    userFacing: 'The request contained invalid input. Please try again.',
    userFacingKey: 'err.IPC_BAD_INPUT',
    category: 'ipc',
  },
  IPC_DB_ERROR: {
    userFacing: 'A local database error occurred. Restarting the app may help.',
    userFacingKey: 'err.IPC_DB_ERROR',
    category: 'ipc',
  },
  IPC_NOT_FOUND: {
    userFacing: 'The requested item was not found.',
    userFacingKey: 'err.IPC_NOT_FOUND',
    category: 'ipc',
  },

  // Provider / network
  PROVIDER_AUTH_MISSING: {
    userFacing: 'No API key found for this provider. Please add your key in Settings.',
    userFacingKey: 'err.PROVIDER_AUTH_MISSING',
    category: 'provider',
  },
  PROVIDER_KEY_MISSING: {
    userFacing: 'No API key is stored for this provider. Add one in Settings.',
    userFacingKey: 'err.PROVIDER_KEY_MISSING',
    category: 'provider',
  },
  PROVIDER_ACTIVE_MISSING_KEY: {
    userFacing: 'The active provider has no API key. Open Settings to add one.',
    userFacingKey: 'err.PROVIDER_ACTIVE_MISSING_KEY',
    category: 'provider',
  },
  PROVIDER_NOT_SUPPORTED: {
    userFacing: 'This provider is not supported. Check your provider configuration.',
    userFacingKey: 'err.PROVIDER_NOT_SUPPORTED',
    category: 'provider',
  },
  PROVIDER_MODEL_UNKNOWN: {
    userFacing: 'The selected model is not available for this provider.',
    userFacingKey: 'err.PROVIDER_MODEL_UNKNOWN',
    category: 'provider',
  },
  PROVIDER_BASE_URL_MISSING: {
    userFacing: 'A base URL is required for this provider. Configure it in Settings.',
    userFacingKey: 'err.PROVIDER_BASE_URL_MISSING',
    category: 'provider',
  },
  PROVIDER_ERROR: {
    userFacing: 'The provider returned an error. Check your API key and try again.',
    userFacingKey: 'err.PROVIDER_ERROR',
    category: 'provider',
  },
  PROVIDER_HTTP_4XX: {
    userFacing: 'The provider rejected the request. Verify your API key and billing.',
    userFacingKey: 'err.PROVIDER_HTTP_4XX',
    category: 'provider',
  },
  PROVIDER_UPSTREAM_ERROR: {
    userFacing: 'The provider returned an unexpected error. Details are in the log.',
    userFacingKey: 'err.PROVIDER_UPSTREAM_ERROR',
    category: 'provider',
  },
  PROVIDER_ABORTED: {
    userFacing: 'Generation was cancelled.',
    userFacingKey: 'err.PROVIDER_ABORTED',
    category: 'generation',
  },
  PROVIDER_RETRY_EXHAUSTED: {
    userFacing: 'The provider failed after several retries. Check your connection and try again.',
    userFacingKey: 'err.PROVIDER_RETRY_EXHAUSTED',
    category: 'connection',
  },
  CLAUDE_CODE_OAUTH_ONLY: {
    userFacing:
      'Your Claude Code login uses an Anthropic subscription (Pro/Max). Third-party apps cannot reuse the subscription quota — generate an API key at console.anthropic.com and use it here.',
    userFacingKey: 'err.CLAUDE_CODE_OAUTH_ONLY',
    category: 'provider',
  },
  CODEX_TOKEN_PARSE_FAILED: {
    userFacing: 'Local ChatGPT login is corrupted. Please re-login in Settings.',
    userFacingKey: 'err.CODEX_TOKEN_PARSE_FAILED',
    category: 'provider',
  },
  CODEX_TOKEN_NOT_LOGGED_IN: {
    userFacing: 'ChatGPT subscription is not signed in. Please log in via Settings.',
    userFacingKey: 'err.CODEX_TOKEN_NOT_LOGGED_IN',
    category: 'provider',
  },

  // Generation / input
  INPUT_EMPTY_PROMPT: {
    userFacing: 'The prompt cannot be empty.',
    userFacingKey: 'err.INPUT_EMPTY_PROMPT',
    category: 'generation',
  },
  INPUT_EMPTY_COMMENT: {
    userFacing: 'The comment cannot be empty.',
    userFacingKey: 'err.INPUT_EMPTY_COMMENT',
    category: 'generation',
  },
  INPUT_EMPTY_HTML: {
    userFacing: 'Existing HTML is required for this operation.',
    userFacingKey: 'err.INPUT_EMPTY_HTML',
    category: 'generation',
  },
  INPUT_UNSUPPORTED_MODE: {
    userFacing: 'This generation mode is not supported.',
    userFacingKey: 'err.INPUT_UNSUPPORTED_MODE',
    category: 'generation',
  },
  GENERATION_TIMEOUT: {
    userFacing: 'Generation timed out. Try a shorter prompt or increase the timeout in Settings.',
    userFacingKey: 'err.GENERATION_TIMEOUT',
    category: 'generation',
  },

  // Config
  CONFIG_READ_FAILED: {
    userFacing: 'Failed to read configuration file. Check file permissions.',
    userFacingKey: 'err.CONFIG_READ_FAILED',
    category: 'other',
  },
  CONFIG_PARSE_FAILED: {
    userFacing: 'Configuration file could not be parsed. It may be corrupt.',
    userFacingKey: 'err.CONFIG_PARSE_FAILED',
    category: 'other',
  },
  CONFIG_SCHEMA_INVALID: {
    userFacing: 'Configuration file has an unrecognised format. Please reconfigure.',
    userFacingKey: 'err.CONFIG_SCHEMA_INVALID',
    category: 'other',
  },
  CONFIG_NOT_LOADED: {
    userFacing: 'Configuration has not been loaded yet. Please restart the app.',
    userFacingKey: 'err.CONFIG_NOT_LOADED',
    category: 'other',
  },
  CONFIG_MISSING: {
    userFacing: 'No configuration found. Complete onboarding to get started.',
    userFacingKey: 'err.CONFIG_MISSING',
    category: 'other',
  },

  // Snapshot / design DB
  SNAPSHOTS_UNAVAILABLE: {
    userFacing: 'The local design database is unavailable. Restarting the app may help.',
    userFacingKey: 'err.SNAPSHOTS_UNAVAILABLE',
    category: 'snapshot',
  },

  // Storage settings
  BOOT_ORDER: {
    userFacing: 'An internal startup error occurred. Please restart the app.',
    userFacingKey: 'err.BOOT_ORDER',
    category: 'other',
  },
  STORAGE_SETTINGS_READ_FAILED: {
    userFacing: 'Failed to read storage location settings.',
    userFacingKey: 'err.STORAGE_SETTINGS_READ_FAILED',
    category: 'other',
  },
  STORAGE_SETTINGS_PARSE_FAILED: {
    userFacing: 'Storage location settings could not be parsed.',
    userFacingKey: 'err.STORAGE_SETTINGS_PARSE_FAILED',
    category: 'other',
  },
  STORAGE_SETTINGS_INVALID: {
    userFacing: 'Storage location settings contain invalid data.',
    userFacingKey: 'err.STORAGE_SETTINGS_INVALID',
    category: 'other',
  },

  // Keychain
  KEYCHAIN_UNAVAILABLE: {
    userFacing: 'OS keychain (secure storage) is not available. API keys cannot be stored.',
    userFacingKey: 'err.KEYCHAIN_UNAVAILABLE',
    category: 'other',
  },
  KEYCHAIN_EMPTY_INPUT: {
    userFacing: 'Cannot encrypt or decrypt an empty value.',
    userFacingKey: 'err.KEYCHAIN_EMPTY_INPUT',
    category: 'other',
  },

  // Attachments / reference URL
  ATTACHMENT_TOO_LARGE: {
    userFacing: 'One or more attachments exceed the size limit.',
    userFacingKey: 'err.ATTACHMENT_TOO_LARGE',
    category: 'generation',
  },
  ATTACHMENT_READ_FAILED: {
    userFacing: 'Failed to read an attachment file. Check that the file still exists.',
    userFacingKey: 'err.ATTACHMENT_READ_FAILED',
    category: 'generation',
  },
  REFERENCE_URL_TOO_LARGE: {
    userFacing: 'The reference URL content is too large to include.',
    userFacingKey: 'err.REFERENCE_URL_TOO_LARGE',
    category: 'generation',
  },
  REFERENCE_URL_FETCH_FAILED: {
    userFacing: 'Could not fetch the reference URL. Check the URL and your internet connection.',
    userFacingKey: 'err.REFERENCE_URL_FETCH_FAILED',
    category: 'connection',
  },
  REFERENCE_URL_FETCH_TIMEOUT: {
    userFacing: 'Fetching the reference URL timed out. Try again or use a different URL.',
    userFacingKey: 'err.REFERENCE_URL_FETCH_TIMEOUT',
    category: 'connection',
  },
  REFERENCE_URL_UNSUPPORTED: {
    userFacing: 'This type of reference URL is not supported.',
    userFacingKey: 'err.REFERENCE_URL_UNSUPPORTED',
    category: 'generation',
  },

  // Preferences
  PREFERENCES_READ_FAIL: {
    userFacing: 'Failed to read preferences. Default settings will be used.',
    userFacingKey: 'err.PREFERENCES_READ_FAIL',
    category: 'preferences',
  },
  PREFERENCES_INVALID_TIMEOUT: {
    userFacing: 'The generation timeout value is invalid.',
    userFacingKey: 'err.PREFERENCES_INVALID_TIMEOUT',
    category: 'preferences',
  },

  // Skills
  SKILL_LOAD_FAILED: {
    userFacing: 'One or more skills failed to load. Check your skill files for errors.',
    userFacingKey: 'err.SKILL_LOAD_FAILED',
    category: 'other',
  },

  // Exporters
  EXPORTER_UNKNOWN: {
    userFacing: 'Unknown export format requested.',
    userFacingKey: 'err.EXPORTER_UNKNOWN',
    category: 'other',
  },
  EXPORTER_NO_CHROME: {
    userFacing: 'Chrome or Chromium was not found. Install it to enable PDF export.',
    userFacingKey: 'err.EXPORTER_NO_CHROME',
    category: 'other',
  },
  EXPORTER_PDF_FAILED: {
    userFacing: 'PDF export failed. Ensure Chrome is installed and try again.',
    userFacingKey: 'err.EXPORTER_PDF_FAILED',
    category: 'other',
  },
  EXPORTER_PPTX_FAILED: {
    userFacing: 'PowerPoint export failed.',
    userFacingKey: 'err.EXPORTER_PPTX_FAILED',
    category: 'other',
  },
  EXPORTER_ZIP_UNSAFE_PATH: {
    userFacing: 'Export was blocked: an asset path would escape the ZIP archive.',
    userFacingKey: 'err.EXPORTER_ZIP_UNSAFE_PATH',
    category: 'other',
  },
  EXPORTER_ZIP_FAILED: {
    userFacing: 'ZIP export failed.',
    userFacingKey: 'err.EXPORTER_ZIP_FAILED',
    category: 'other',
  },

  // Misc / shell
  OPEN_PATH_FAILED: {
    userFacing: 'Could not open the requested folder or file.',
    userFacingKey: 'err.OPEN_PATH_FAILED',
    category: 'other',
  },

  // Diagnostic events
  RENDERER_ERROR: {
    userFacing: 'An error occurred in the renderer. Details are in the log.',
    userFacingKey: 'err.RENDERER_ERROR',
    category: 'other',
  },
};
