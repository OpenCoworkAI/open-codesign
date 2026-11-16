import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LINUX_PASSWORD_STORE_FILE = 'linux-password-store.json';
const SECURE_PASSWORD_STORES = ['gnome-libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const;

interface PasswordStoreCommandLine {
  hasSwitch(name: string): boolean;
  appendSwitch(name: string, value: string): void;
}

export function linuxPasswordStorePath(directory: string): string {
  return join(directory, LINUX_PASSWORD_STORE_FILE);
}

/** Must run before app.ready, when Chromium selects its Linux key provider. */
export function applyLinuxPasswordStore(
  platform: NodeJS.Platform,
  directory: string,
  commandLine: PasswordStoreCommandLine,
): { source: 'platform-default' | 'command-line' | 'file' | 'invalid'; warning?: string } {
  if (platform !== 'linux') return { source: 'platform-default' };
  // Explicit launch flags win, including basic: the keychain write guard
  // still refuses basic_text rather than silently changing the user's choice.
  if (commandLine.hasSwitch('password-store')) return { source: 'command-line' };

  const filename = linuxPasswordStorePath(directory);
  let contents: string;
  try {
    contents = readFileSync(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { source: 'platform-default' };
    return {
      source: 'invalid',
      warning: `Cannot read ${filename}; using Electron's default secure-storage selection.`,
    };
  }
  try {
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid settings');
    const settings = value as Record<string, unknown>;
    if (
      settings['schemaVersion'] !== 1 ||
      !SECURE_PASSWORD_STORES.includes(
        settings['passwordStore'] as (typeof SECURE_PASSWORD_STORES)[number],
      )
    ) {
      throw new Error('Invalid password-store setting');
    }
    commandLine.appendSwitch('password-store', settings['passwordStore'] as string);
    return { source: 'file' };
  } catch {
    return {
      source: 'invalid',
      warning: `${filename} must contain schemaVersion: 1 and passwordStore: gnome-libsecret, kwallet, kwallet5, or kwallet6. Insecure backends are not supported.`,
    };
  }
}

export function linuxPasswordStoreRemediation(directory: string): string {
  return `A Secret Service or KWallet may already be installed but not selected for this desktop. In ${linuxPasswordStorePath(directory)}, set {"schemaVersion":1,"passwordStore":"gnome-libsecret"} (or kwallet, kwallet5, kwallet6 for your installed wallet), then fully quit and restart Open CoDesign. An explicit --password-store launch flag takes precedence. No plaintext fallback is used.`;
}
