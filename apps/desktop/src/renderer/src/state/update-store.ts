import type { StoreApi } from 'zustand';
import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'available';

export interface UpdateState {
  status: UpdateStatus;
  version: string;
  releaseUrl: string;
  dismissedVersion: string;
  // Gate so listeners can attach immediately (catching one-shot events) while
  // the banner stays hidden until persisted prefs have seeded dismissedVersion.
  dismissedVersionReady: boolean;
  setAvailable(info: { version: string; releaseUrl: string }): void;
  dismiss(): void;
  markDismissedVersionReady(dismissedVersion: string): void;
}

export function createUpdateStore(init: { dismissedVersion: string }): StoreApi<UpdateState> {
  return create<UpdateState>((set, get) => ({
    status: 'idle',
    version: '',
    releaseUrl: '',
    dismissedVersion: init.dismissedVersion,
    dismissedVersionReady: false,
    setAvailable: ({ version, releaseUrl }) => set({ status: 'available', version, releaseUrl }),
    dismiss: () => {
      const v = get().version;
      if (!v) return;
      set({ dismissedVersion: v });
    },
    markDismissedVersionReady: (dismissedVersion) =>
      set({ dismissedVersion, dismissedVersionReady: true }),
  }));
}

// Pure predicate — kept out of the store so consumers (React + tests) read
// primitive fields directly, making Zustand's subscription explicit.
export function shouldShowBanner(s: UpdateState): boolean {
  if (!s.dismissedVersionReady) return false;
  return s.status === 'available' && s.version !== '' && s.version !== s.dismissedVersion;
}
