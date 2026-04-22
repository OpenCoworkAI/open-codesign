import type { ProviderEntry } from './config';

/**
 * Shared contract between the main process (`onboarding-ipc.ts`) and the
 * preload facade (`preload/index.ts`) for the `config:v1:detect-external-configs`
 * IPC channel. Keeping both sides on ONE type prevents the silent drift that
 * bit us twice before: Electron's structured clone ships every own property
 * over IPC regardless of the type facade, so if main writes a field the
 * preload type hides, it still reaches the renderer — but if main stops
 * writing a field the Settings UI depends on, renderers break at runtime
 * with no typecheck warning. Importing one source on both sides makes that
 * class of bug unrepresentable.
 */

/** Coarse classification for a Claude Code user we just scanned. Drives
 *  which banner the Settings UI shows (subscription warning vs. one-click
 *  import vs. manual-finish-required) and which import path we take.
 *
 *  Inlined here rather than re-exported from `claude-code-config` because
 *  the `packages/shared` package must not depend on any `apps/desktop`
 *  module. String values stay in lockstep with the parser's output. */
export type ClaudeCodeUserType =
  | 'has-api-key'
  | 'oauth-only'
  | 'local-proxy'
  | 'remote-gateway'
  | 'parse-error'
  | 'no-config';

export interface CodexDetectionMeta {
  providers: ProviderEntry[];
  activeProvider: string | null;
  activeModel: string | null;
  warnings: string[];
}

export interface ClaudeCodeDetectionMeta {
  userType: ClaudeCodeUserType;
  baseUrl: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeySource: 'settings-json' | 'shell-env' | 'none';
  settingsPath: string;
  warnings: string[];
}

export interface GeminiDetectionMeta {
  hasApiKey: boolean;
  apiKeySource: 'gemini-env' | 'home-env' | 'shell-env' | 'none';
  /** Absolute path of the `.env` that supplied the key, if any. */
  keyPath: string | null;
  baseUrl: string;
  defaultModel: string;
  warnings: string[];
  /** True when Gemini evidence was found but we refuse to import (Vertex
   *  AI, etc.). UI renders a warning-style banner with no import button. */
  blocked: boolean;
}

export interface OpencodeDetectionMeta {
  providers: ProviderEntry[];
  activeProvider: string | null;
  activeModel: string | null;
  warnings: string[];
  /** True when opencode config was found but produced no importable
   *  providers (malformed JSON, all OAuth, all unsupported). UI renders
   *  a warning-only banner, mirroring the Gemini Vertex case. */
  blocked: boolean;
}

export interface ExternalConfigsDetection {
  codex?: CodexDetectionMeta;
  claudeCode?: ClaudeCodeDetectionMeta;
  gemini?: GeminiDetectionMeta;
  opencode?: OpencodeDetectionMeta;
}
