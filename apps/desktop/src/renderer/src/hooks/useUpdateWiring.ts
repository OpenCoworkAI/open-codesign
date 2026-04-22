import { useEffect } from 'react';
import type { StoreApi } from 'zustand';
import type { UpdateState } from '../state/update-store';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/;

export function isValidVersion(v: string): boolean {
  return VERSION_RE.test(v);
}

export function useUpdateWiring(store: StoreApi<UpdateState> | null): void {
  useEffect(() => {
    if (!store) return;
    if (!window.codesign) {
      console.warn('[useUpdateWiring] window.codesign missing; update notifications disabled');
      return;
    }

    const offAvail = window.codesign.onUpdateAvailable((info) => {
      const typed = info as { version?: string };
      const version = typed.version ?? '';
      if (!version || !isValidVersion(version)) return;
      const releaseUrl = `https://github.com/OpenCoworkAI/open-codesign/releases/tag/v${version}`;
      store.getState().setAvailable({ version, releaseUrl });
    });

    return () => {
      offAvail();
    };
  }, [store]);
}
