import type { ChatMessage, ModelRef } from '@open-codesign/shared';
import { contextBridge, ipcRenderer } from 'electron';

export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'zip';
export interface ExportInvokeResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

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
  export: (payload: { format: ExportFormat; htmlContent: string; defaultFilename?: string }) =>
    ipcRenderer.invoke('codesign:export', payload) as Promise<ExportInvokeResponse>,
  checkForUpdates: () => ipcRenderer.invoke('codesign:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('codesign:download-update'),
  installUpdate: () => ipcRenderer.invoke('codesign:install-update'),
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => cb(info);
    ipcRenderer.on('codesign:update-available', listener);
    return () => ipcRenderer.removeListener('codesign:update-available', listener);
  },
};

contextBridge.exposeInMainWorld('codesign', api);

export type CodesignApi = typeof api;
