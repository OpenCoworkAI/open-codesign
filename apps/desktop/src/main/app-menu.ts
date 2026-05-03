import { app, dialog, Menu } from 'electron';
import { autoUpdater } from 'electron-updater';
import { getUpdateErrorMessage, isMissingUpdateMetadataError } from './update-errors';

export function registerAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu' as const,
    },
    {
      role: 'fileMenu' as const,
    },
    {
      role: 'editMenu' as const,
    },
    {
      role: 'viewMenu' as const,
    },
    {
      role: 'windowMenu' as const,
    },
    {
      label: 'Help',
      role: 'help' as const,
      submenu: [
        {
          label: 'Check for Updates\u2026',
          click: async () => {
            if (!app.isPackaged) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Update Check Disabled',
                message: 'Update checks are disabled in dev builds.',
              });
              return;
            }
            try {
              const result = await autoUpdater.checkForUpdates();
              if (!result?.updateInfo) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Update Check',
                  message: 'Could not determine the latest version. Try again later.',
                });
                return;
              }
              if (result.updateInfo.version === app.getVersion()) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Up to Date',
                  message: `You're on the latest version (${app.getVersion()}).`,
                });
              }
              // If a newer version is available, the update-available event fires
              // and the renderer banner handles it — no dialog needed here.
            } catch (err) {
              if (isMissingUpdateMetadataError(err)) {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Update Check Unavailable',
                  message:
                    'No update channel metadata has been published for this build yet. Try again after the next public release.',
                });
                return;
              }
              dialog.showErrorBox('Update Check Failed', getUpdateErrorMessage(err));
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
