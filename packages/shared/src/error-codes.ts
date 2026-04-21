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
  PROVIDER_NOT_SUPPORTED: 'PROVIDER_NOT_SUPPORTED',
  PROVIDER_MODEL_UNKNOWN: 'PROVIDER_MODEL_UNKNOWN',
  PROVIDER_BASE_URL_MISSING: 'PROVIDER_BASE_URL_MISSING',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PROVIDER_HTTP_4XX: 'PROVIDER_HTTP_4XX',
  PROVIDER_ABORTED: 'PROVIDER_ABORTED',
  PROVIDER_RETRY_EXHAUSTED: 'PROVIDER_RETRY_EXHAUSTED',

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
  SSH_PROFILE_NOT_FOUND: 'SSH_PROFILE_NOT_FOUND',
  SSH_KEY_READ_FAILED: 'SSH_KEY_READ_FAILED',
  SSH_CONNECT_FAILED: 'SSH_CONNECT_FAILED',
  SSH_SFTP_FAILED: 'SSH_SFTP_FAILED',
  SSH_REMOTE_PATH_INVALID: 'SSH_REMOTE_PATH_INVALID',
  SSH_REMOTE_READ_FAILED: 'SSH_REMOTE_READ_FAILED',
  SSH_REMOTE_WRITE_FAILED: 'SSH_REMOTE_WRITE_FAILED',

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
} as const;

/** Literal union of every known CodesignError code. */
export type CodesignErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

type ErrorCodeDescription = {
  userFacing: string;
  category: 'ipc' | 'provider' | 'generation' | 'snapshot' | 'preferences' | 'connection' | 'other';
};

export const ERROR_CODE_DESCRIPTIONS: Record<CodesignErrorCode, ErrorCodeDescription> = {
  // IPC validation
  IPC_BAD_INPUT: {
    userFacing: 'The request contained invalid input. Please try again.',
    category: 'ipc',
  },
  IPC_DB_ERROR: {
    userFacing: 'A local database error occurred. Restarting the app may help.',
    category: 'ipc',
  },
  IPC_NOT_FOUND: {
    userFacing: 'The requested item was not found.',
    category: 'ipc',
  },

  // Provider / network
  PROVIDER_AUTH_MISSING: {
    userFacing: 'No API key found for this provider. Please add your key in Settings.',
    category: 'provider',
  },
  PROVIDER_KEY_MISSING: {
    userFacing: 'No API key is stored for this provider. Add one in Settings.',
    category: 'provider',
  },
  PROVIDER_NOT_SUPPORTED: {
    userFacing: 'This provider is not supported. Check your provider configuration.',
    category: 'provider',
  },
  PROVIDER_MODEL_UNKNOWN: {
    userFacing: 'The selected model is not available for this provider.',
    category: 'provider',
  },
  PROVIDER_BASE_URL_MISSING: {
    userFacing: 'A base URL is required for this provider. Configure it in Settings.',
    category: 'provider',
  },
  PROVIDER_ERROR: {
    userFacing: 'The provider returned an error. Check your API key and try again.',
    category: 'provider',
  },
  PROVIDER_HTTP_4XX: {
    userFacing: 'The provider rejected the request. Verify your API key and billing.',
    category: 'provider',
  },
  PROVIDER_ABORTED: {
    userFacing: 'Generation was cancelled.',
    category: 'generation',
  },
  PROVIDER_RETRY_EXHAUSTED: {
    userFacing: 'The provider failed after several retries. Check your connection and try again.',
    category: 'connection',
  },

  // Generation / input
  INPUT_EMPTY_PROMPT: {
    userFacing: 'The prompt cannot be empty.',
    category: 'generation',
  },
  INPUT_EMPTY_COMMENT: {
    userFacing: 'The comment cannot be empty.',
    category: 'generation',
  },
  INPUT_EMPTY_HTML: {
    userFacing: 'Existing HTML is required for this operation.',
    category: 'generation',
  },
  INPUT_UNSUPPORTED_MODE: {
    userFacing: 'This generation mode is not supported.',
    category: 'generation',
  },
  GENERATION_TIMEOUT: {
    userFacing: 'Generation timed out. Try a shorter prompt or increase the timeout in Settings.',
    category: 'generation',
  },

  // Config
  CONFIG_READ_FAILED: {
    userFacing: 'Failed to read configuration file. Check file permissions.',
    category: 'other',
  },
  CONFIG_PARSE_FAILED: {
    userFacing: 'Configuration file could not be parsed. It may be corrupt.',
    category: 'other',
  },
  CONFIG_SCHEMA_INVALID: {
    userFacing: 'Configuration file has an unrecognised format. Please reconfigure.',
    category: 'other',
  },
  CONFIG_NOT_LOADED: {
    userFacing: 'Configuration has not been loaded yet. Please restart the app.',
    category: 'other',
  },
  CONFIG_MISSING: {
    userFacing: 'No configuration found. Complete onboarding to get started.',
    category: 'other',
  },

  // Snapshot / design DB
  SNAPSHOTS_UNAVAILABLE: {
    userFacing: 'The local design database is unavailable. Restarting the app may help.',
    category: 'snapshot',
  },

  // Storage settings
  BOOT_ORDER: {
    userFacing: 'An internal startup error occurred. Please restart the app.',
    category: 'other',
  },
  STORAGE_SETTINGS_READ_FAILED: {
    userFacing: 'Failed to read storage location settings.',
    category: 'other',
  },
  STORAGE_SETTINGS_PARSE_FAILED: {
    userFacing: 'Storage location settings could not be parsed.',
    category: 'other',
  },
  STORAGE_SETTINGS_INVALID: {
    userFacing: 'Storage location settings contain invalid data.',
    category: 'other',
  },

  // Keychain
  KEYCHAIN_UNAVAILABLE: {
    userFacing: 'OS keychain (secure storage) is not available. API keys cannot be stored.',
    category: 'other',
  },
  KEYCHAIN_EMPTY_INPUT: {
    userFacing: 'Cannot encrypt or decrypt an empty value.',
    category: 'other',
  },

  // Attachments / reference URL
  ATTACHMENT_TOO_LARGE: {
    userFacing: 'One or more attachments exceed the size limit.',
    category: 'generation',
  },
  ATTACHMENT_READ_FAILED: {
    userFacing: 'Failed to read an attachment file. Check that the file still exists.',
    category: 'generation',
  },
  REFERENCE_URL_TOO_LARGE: {
    userFacing: 'The reference URL content is too large to include.',
    category: 'generation',
  },
  REFERENCE_URL_FETCH_FAILED: {
    userFacing: 'Could not fetch the reference URL. Check the URL and your internet connection.',
    category: 'connection',
  },
  REFERENCE_URL_FETCH_TIMEOUT: {
    userFacing: 'Fetching the reference URL timed out. Try again or use a different URL.',
    category: 'connection',
  },
  REFERENCE_URL_UNSUPPORTED: {
    userFacing: 'This type of reference URL is not supported.',
    category: 'generation',
  },
  SSH_PROFILE_NOT_FOUND: {
    userFacing: 'The selected SSH profile was not found.',
    category: 'connection',
  },
  SSH_KEY_READ_FAILED: {
    userFacing: 'The SSH private key could not be read.',
    category: 'connection',
  },
  SSH_CONNECT_FAILED: {
    userFacing: 'Could not connect to the SSH server. Check the host, credentials, and network.',
    category: 'connection',
  },
  SSH_SFTP_FAILED: {
    userFacing: 'Could not start an SFTP session on the SSH server.',
    category: 'connection',
  },
  SSH_REMOTE_PATH_INVALID: {
    userFacing: 'The remote path is invalid.',
    category: 'generation',
  },
  SSH_REMOTE_READ_FAILED: {
    userFacing: 'Could not read the requested remote file.',
    category: 'generation',
  },
  SSH_REMOTE_WRITE_FAILED: {
    userFacing: 'Could not write the file to the remote server.',
    category: 'generation',
  },

  // Preferences
  PREFERENCES_READ_FAIL: {
    userFacing: 'Failed to read preferences. Default settings will be used.',
    category: 'preferences',
  },
  PREFERENCES_INVALID_TIMEOUT: {
    userFacing: 'The generation timeout value is invalid.',
    category: 'preferences',
  },

  // Skills
  SKILL_LOAD_FAILED: {
    userFacing: 'One or more skills failed to load. Check your skill files for errors.',
    category: 'other',
  },

  // Exporters
  EXPORTER_UNKNOWN: {
    userFacing: 'Unknown export format requested.',
    category: 'other',
  },
  EXPORTER_NO_CHROME: {
    userFacing: 'Chrome or Chromium was not found. Install it to enable PDF export.',
    category: 'other',
  },
  EXPORTER_PDF_FAILED: {
    userFacing: 'PDF export failed. Ensure Chrome is installed and try again.',
    category: 'other',
  },
  EXPORTER_PPTX_FAILED: {
    userFacing: 'PowerPoint export failed.',
    category: 'other',
  },
  EXPORTER_ZIP_UNSAFE_PATH: {
    userFacing: 'Export was blocked: an asset path would escape the ZIP archive.',
    category: 'other',
  },
  EXPORTER_ZIP_FAILED: {
    userFacing: 'ZIP export failed.',
    category: 'other',
  },

  // Misc / shell
  OPEN_PATH_FAILED: {
    userFacing: 'Could not open the requested folder or file.',
    category: 'other',
  },
};
