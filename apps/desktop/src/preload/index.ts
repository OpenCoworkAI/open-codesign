import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  detectProvider: (key: string) =>
    ipcRenderer.invoke('codesign:detect-provider', key) as Promise<string | null>,
  generate: (payload: {
    prompt: string;
    history: ChatMessage[];
    model: ModelRef;
    apiKey: string;
    baseUrl?: string;
  }) => ipcRenderer.invoke('codesign:generate', payload),
  checkForUpdates: () => ipcRenderer.invoke('codesign:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('codesign:download-update'),
  installUpdate: () => ipcRenderer.invoke('codesign:install-update'),
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on('codesign:update-available', listener);
    return () => ipcRenderer.removeListener('codesign:update-available', listener);
  },
  locale: {
    getSystem: () => ipcRenderer.invoke('locale:get-system') as Promise<string>,
    getCurrent: () => ipcRenderer.invoke('locale:get-current') as Promise<string>,
    set: (locale: string) => ipcRenderer.invoke('locale:set', locale) as Promise<string>,
  },
};

contextBridge.exposeInMainWorld('codesign', api);

export type CodesignApi = typeof api;
