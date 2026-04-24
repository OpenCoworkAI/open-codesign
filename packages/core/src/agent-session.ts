/**
 * v0.2 agent-session wrapper around `@mariozechner/pi-coding-agent`.
 *
 * Spike result (docs/spike-pi-results.md, 2026-04-24):
 *   pi-coding-agent satisfies all v0.2 hard needs (bash hook, session
 *   storage, model capability). This module is the boundary: callers
 *   pass cwd / sessionDir / authStorage / permissionHook and get back
 *   an AgentSession plus a teardown hook.
 *
 * NOT yet wired to the legacy `generate()` / `agent.ts` flow — those
 * stay untouched until later phases migrate consumers off the
 * pi-agent-core code path.
 */

import path from 'node:path';
import type { Api, Model } from '@mariozechner/pi-ai';
import {
  type AgentSession,
  type AuthStorage,
  type CreateAgentSessionResult,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  getAgentDir,
  isToolCallEventType,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';

export interface PermissionDecision {
  /** Allow this command to run. */
  allow: boolean;
  /** Optional human-readable reason (used when blocked). */
  reason?: string;
}

export type PermissionHook = (cmd: string) => Promise<PermissionDecision>;

export interface CreateSessionOptions {
  /** Workspace root (= pi cwd). */
  cwd: string;
  /** Absolute directory where session JSONL files live. */
  sessionDir: string;
  /** Pre-populated AuthStorage (see auth-bridge in apps/desktop). */
  authStorage: AuthStorage;
  /** Async permission gate for bash invocations. */
  permissionHook: PermissionHook;
  /** Model to use for this session. */
  model?: Model<Api>;
  /** Extra extension factories registered before resource load. */
  extraFactories?: ExtensionFactory[];
  /** Override the agent global config dir (default: pi's `getAgentDir()`). */
  agentDir?: string;
}

export interface SessionHandle {
  session: AgentSession;
  result: CreateAgentSessionResult;
  sessionFile: string;
}

export async function createCodesignSession(options: CreateSessionOptions): Promise<SessionHandle> {
  const bashGate: ExtensionFactory = (pi) => {
    pi.on('tool_call', async (event) => {
      if (isToolCallEventType('bash', event)) {
        const decision = await options.permissionHook(event.input.command);
        if (!decision.allow) {
          return { block: true, reason: decision.reason ?? 'user denied' };
        }
      }
    });
  };

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir ?? getAgentDir(),
    extensionFactories: [bashGate, ...(options.extraFactories ?? [])],
  });
  await resourceLoader.reload();

  const sessionManager = SessionManager.create(options.cwd, options.sessionDir);
  const modelRegistry = ModelRegistry.create(options.authStorage);

  const result = await createAgentSession({
    cwd: options.cwd,
    authStorage: options.authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager,
    ...(options.model ? { model: options.model } : {}),
  });

  const sessionFile = sessionManager.getSessionFile() ?? path.join(options.sessionDir, '<unsaved>');

  return { session: result.session, result, sessionFile };
}

export { AuthStorage, ModelRegistry, SessionManager } from '@mariozechner/pi-coding-agent';
