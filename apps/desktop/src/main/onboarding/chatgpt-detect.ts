import { readFile } from 'node:fs/promises';
import { codexAuthPath } from '../imports/codex-config';
import { getLogger } from '../logger';

const logger = getLogger('settings-ipc');

/** Test seam: the real IPC handler calls `detectChatgptSubscription()` with
 *  no args, which resolves the path via `codexAuthPath()`. Tests can pass
 *  a fabricated path pointing at a tmpdir file without having to mock
 *  `node:fs/promises`. */
export async function detectChatgptSubscription(
  authPath: string = codexAuthPath(),
): Promise<boolean> {
  try {
    const raw = await readFile(authPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    return (parsed as Record<string, unknown>)['auth_mode'] === 'chatgpt';
  } catch (err) {
    // ENOENT is the "no Codex installed" case; every other error (EACCES,
    // corrupt JSON, etc.) drives the wrong error-message branch for the
    // caller, so log it instead of swallowing silently.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('detect_chatgpt_subscription.failed', {
        code: code ?? 'unknown',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return false;
  }
}
