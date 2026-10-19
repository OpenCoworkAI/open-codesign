import { realpath } from 'node:fs/promises';
import {
  CodesignError,
  SourceEntryGetRequestV1,
  SourceEntrySelectRequestV1,
} from '@open-codesign/shared';
import type { BrowserWindow } from 'electron';
import { ipcMain } from './electron-runtime';
import type { Database } from './snapshots-db';
import { assertSourceWorkspaceIdle } from './source-edits-ipc';
import { getSourceEntry, selectSourceEntry } from './source-entry';

export function registerSourceEntryIpc(db: Database, getWin: () => BrowserWindow | null): void {
  function assertSender(event: unknown): void {
    const win = getWin();
    const sender = (event as { sender?: unknown } | null)?.sender;
    if (!win || win.isDestroyed() || sender !== win.webContents || win.webContents.isDestroyed())
      throw new CodesignError('The design window is unavailable.', 'IPC_BAD_INPUT');
  }

  ipcMain.handle('codesign:source-entry:v1:get', async (event: unknown, raw: unknown) => {
    assertSender(event);
    const input = SourceEntryGetRequestV1.safeParse(raw);
    if (!input.success) throw new CodesignError('Invalid source entry request.', 'IPC_BAD_INPUT');
    return getSourceEntry(db, input.data.designId);
  });

  ipcMain.handle('codesign:source-entry:v1:select', async (event: unknown, raw: unknown) => {
    assertSender(event);
    const input = SourceEntrySelectRequestV1.safeParse(raw);
    if (!input.success)
      throw new CodesignError('Invalid source selection request.', 'IPC_BAD_INPUT');
    await selectSourceEntry(db, input.data, async () => {
      assertSender(event);
      await assertSourceWorkspaceIdle(
        input.data.designId,
        await realpath(input.data.expectedWorkspacePath),
      );
      assertSender(event);
    });
    return getSourceEntry(db, input.data.designId);
  });
}
