import { renameSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DebugModelOptions } from '../debug/contract';
import { projectCodexLogin } from '../debug/model-auth';
import { fixtureConfig, selectDebugConfig } from '../debug/model-config';
import { installDebugModelBoundary } from '../debug/model-stream';
import { assertBackgroundCredentialState, enableBackgroundModels } from './background-debug';
import { getCodexTokenStore } from './codex-oauth-ipc';
import { app, BACKGROUND_DEBUG } from './electron-runtime';
import { decryptSecret } from './keychain';
import { setCachedConfig } from './onboarding/config-cache';

export async function initializeBackgroundModel(): Promise<
  ((teardown: () => void) => void) | undefined
> {
  const raw = process.env['CODESIGN_BACKGROUND_MODEL'];
  if (!BACKGROUND_DEBUG || !raw) return undefined;
  assertBackgroundCredentialState();
  const options = JSON.parse(raw) as DebugModelOptions;
  if (options.mode !== 'fixture' && options.mode !== 'live')
    throw new Error('BACKGROUND_MODEL_MODE_INVALID');
  let config = fixtureConfig();
  if (options.mode === 'live') {
    if (!options.config) throw new Error('BACKGROUND_MODEL_CONFIG_REQUIRED');
    let text: string;
    try {
      if ((await stat(options.config)).size > 1024 * 1024) throw new Error('Config too large');
      text = await readFile(options.config, 'utf8');
    } catch {
      throw new Error('BACKGROUND_MODEL_CONFIG_UNREADABLE');
    }
    config = selectDebugConfig(text, options);
  }
  const secrets: string[] = [];
  if (options.codexAuth) {
    let rawAuth: string;
    try {
      if ((await stat(options.codexAuth)).size > 1024 * 1024) throw new Error();
      rawAuth = await readFile(options.codexAuth, 'utf8');
    } catch {
      throw new Error('BACKGROUND_MODEL_AUTH_UNREADABLE');
    }
    const auth = projectCodexLogin(rawAuth);
    secrets.push(auth.accessToken, auth.refreshToken, auth.idToken);
    await getCodexTokenStore().write(auth);
  }
  for (const ref of Object.values(config.secrets)) {
    // Windows DPAPI does not need a visible keychain prompt. Other OS keychains may.
    if (process.platform !== 'win32' && !ref.ciphertext.startsWith('plain:'))
      throw new Error('BACKGROUND_MODEL_KEYCHAIN_INTERACTION_UNSUPPORTED');
    try {
      secrets.push(decryptSecret(ref.ciphertext), ref.ciphertext);
    } catch {
      throw new Error('BACKGROUND_MODEL_CREDENTIAL_UNREADABLE');
    }
  }
  for (const entry of Object.values(config.providers))
    secrets.push(...Object.values(entry.httpHeaders ?? {}));
  setCachedConfig(config); // Memory only: never migrate or write the source configuration.
  const root = process.env['CODESIGN_BACKGROUND_DEBUG_ROOT'];
  if (!root) throw new Error('BACKGROUND_MODEL_HOST_REQUIRED');
  const save = (name: string, data: unknown) => {
    const file = join(root, name);
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  };
  const boundary = installDebugModelBoundary({
    ...options,
    provider: config.activeProvider,
    model: config.activeModel,
    secrets,
    record: (evidence) => save('model-evidence.json', evidence),
  });
  const runs: { generationId: string; status: string }[] = [];
  const pending = new Set<Promise<unknown>>();
  let stopping = false;
  enableBackgroundModels(
    async (payload, invoke) => {
      if (stopping) throw new Error('BACKGROUND_MODEL_CLOSED');
      const id = (payload as { generationId?: unknown })?.generationId;
      const run = {
        generationId: typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : 'invalid',
        status: 'running',
      };
      runs.push(run);
      save('model-runs.json', runs);
      const task = invoke();
      pending.add(task);
      try {
        const result = await task;
        return result;
      } catch (error) {
        if (run.status === 'running') run.status = stopping ? 'cancelled' : 'failed';
        throw error;
      } finally {
        pending.delete(task);
        save('model-runs.json', runs);
      }
    },
    (id, status) => {
      const run = runs.find((entry) => entry.generationId === id);
      if (run) run.status = status;
      save('model-runs.json', runs);
    },
  );
  return (teardown) => {
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      teardown();
      await boundary.stop();
      await Promise.allSettled([...pending]);
      process.send?.({ type: 'background-model-stopped' });
      app.quit();
    };
    process.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        (message as { type?: unknown }).type === 'background-model-stop'
      )
        void stop();
    });
    process.on('disconnect', () => {
      void stop();
    });
  };
}
