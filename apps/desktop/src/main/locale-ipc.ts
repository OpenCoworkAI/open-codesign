/**
 * Locale IPC handlers (main process).
 *
 * Renderer wiring is intentionally NOT included here — `apps/desktop/src/main/index.ts`
 * and `preload/index.ts` are owned by a parallel branch (preview-ux-v2). After that
 * lands, the maintainer registers these handlers from `index.ts` and exposes them
 * via the preload bridge under `window.electronAPI.locale.{getSystem,getCurrent,set}`.
 *
 * Persistence is in its own file (`~/.config/open-codesign/locale.json`) so user
 * language can be read before the TOML config loader has finished — i18n needs to
 * boot synchronously enough to render the first frame.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { availableLocales, isSupportedLocale, normalizeLocale } from '@open-codesign/i18n';
import { configDir } from './config';
import { app, ipcMain } from './electron-runtime';
import { getLogger } from './logger';

const SCHEMA_VERSION = 1;
const logger = getLogger('locale-ipc');

function localeFile(): string {
  return join(configDir(), 'locale.json');
}

interface LocaleFile {
  schemaVersion: number;
  locale: string;
}

async function readPersisted(): Promise<string | null> {
  const file = localeFile();
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocaleFile>;
    if (typeof parsed.locale === 'string' && parsed.locale.length > 0) {
      return parsed.locale;
    }
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn('locale.read.fail', {
      file,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function writePersisted(locale: string): Promise<void> {
  const file = localeFile();
  await mkdir(dirname(file), { recursive: true });
  const payload: LocaleFile = { schemaVersion: SCHEMA_VERSION, locale };
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function registerLocaleIpc(): void {
  ipcMain.handle('locale:get-system', () => app.getLocale());

  ipcMain.handle('locale:get-current', async () => {
    const persisted = await readPersisted();
    return persisted ?? app.getLocale();
  });

  ipcMain.handle('locale:set', async (_e, raw: unknown) => {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error('locale:set expects a non-empty string');
    }
    // Reject unknown tags up-front rather than persisting garbage and relying
    // on read-time normalization to silently rewrite to "en". A bad write here
    // would mask renderer bugs and leave users on the wrong language until
    // they manually clear locale.json.
    const lower = raw.toLowerCase();
    const recognized =
      isSupportedLocale(raw) ||
      lower === 'zh' ||
      lower.startsWith('zh-hans') ||
      lower === 'zh-cn' ||
      lower === 'zh_cn' ||
      lower.startsWith('en') ||
      lower === 'pt-br' ||
      lower.startsWith('pt-') ||
      lower === 'pt_br' ||
      lower === 'es' ||
      lower.startsWith('es-') ||
      lower === 'es_';
    if (!recognized) {
      throw new Error(
        `locale:set received unsupported locale "${raw}"; expected one of: ${availableLocales.join(', ')}`,
      );
    }
    const canonical = normalizeLocale(raw);
    await writePersisted(canonical);
    return canonical;
  });
}
