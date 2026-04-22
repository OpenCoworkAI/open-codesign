import { describe, expect, it, vi } from 'vitest';
import type { CodexOAuthStatus } from '../../../preload/index';
import {
  performFetchStatus,
  performLogin,
  performLogout,
  resolveViewState,
} from './ChatgptLoginCard';

const LOGIN_STRINGS = { failedTitle: 'login failed', unknownError: 'unknown' };
const LOGOUT_STRINGS = {
  confirmMessage: 'sign out?',
  failedTitle: 'logout failed',
  unknownError: 'unknown',
};
const STATUS_STRINGS = { failedTitle: 'status read failed', unknownError: 'unknown' };

function statusLoggedIn(overrides: Partial<CodexOAuthStatus> = {}): CodexOAuthStatus {
  return {
    loggedIn: true,
    email: 'user@example.com',
    accountId: 'acct_123',
    expiresAt: Date.now() + 3600_000,
    ...overrides,
  };
}

function statusLoggedOut(): CodexOAuthStatus {
  return { loggedIn: false, email: null, accountId: null, expiresAt: null };
}

describe('resolveViewState', () => {
  it('returns not-logged-in when codesign bridge missing (status null)', () => {
    // Matches "window.codesign undefined" — the component leaves status as null
    // and renders the login button.
    expect(resolveViewState(null, false)).toBe('not-logged-in');
  });

  it('returns not-logged-in when status has loggedIn=false', () => {
    expect(resolveViewState(statusLoggedOut(), false)).toBe('not-logged-in');
  });

  it('returns logged-in when status has loggedIn=true', () => {
    expect(resolveViewState(statusLoggedIn(), false)).toBe('logged-in');
  });

  it('returns loading while a login request is in-flight, even with logged-in status', () => {
    // Loading takes precedence so the "opening browser" affordance always wins.
    expect(resolveViewState(statusLoggedIn(), true)).toBe('loading');
    expect(resolveViewState(null, true)).toBe('loading');
  });
});

describe('performLogin', () => {
  it('sets loading true then false, updates status, and notifies the parent on success', async () => {
    const next = statusLoggedIn({ email: 'a@b.com' });
    const api = {
      status: vi.fn(),
      login: vi.fn().mockResolvedValue(next),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const setLoading = vi.fn();
    const onStatusChange = vi.fn().mockResolvedValue(undefined);
    const pushToast = vi.fn();

    await performLogin({
      api,
      setStatus,
      setLoading,
      pushToast,
      onStatusChange,
      strings: LOGIN_STRINGS,
    });

    expect(api.login).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(next);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenNthCalledWith(2, false);
  });

  it('resets loading and surfaces a toast when login rejects', async () => {
    const api = {
      status: vi.fn(),
      login: vi.fn().mockRejectedValue(new Error('network down')),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const setLoading = vi.fn();
    const pushToast = vi.fn();

    await performLogin({ api, setStatus, setLoading, pushToast, strings: LOGIN_STRINGS });

    expect(setStatus).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenNthCalledWith(2, false);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'network down' }),
    );
  });
});

describe('performLogout', () => {
  it('bails without calling the IPC when the confirm dialog is dismissed', async () => {
    const api = {
      status: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(statusLoggedOut()),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();
    const confirm = vi.fn().mockReturnValue(false);

    const result = await performLogout({
      api,
      setStatus,
      pushToast,
      confirm,
      strings: LOGOUT_STRINGS,
    });

    expect(result).toBe(false);
    expect(api.logout).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('calls logout and updates status when the user confirms', async () => {
    const next = statusLoggedOut();
    const api = {
      status: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(next),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();
    const confirm = vi.fn().mockReturnValue(true);
    const onStatusChange = vi.fn();

    const result = await performLogout({
      api,
      setStatus,
      pushToast,
      confirm,
      onStatusChange,
      strings: LOGOUT_STRINGS,
    });

    expect(result).toBe(true);
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(next);
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('surfaces a toast when logout rejects', async () => {
    const api = {
      status: vi.fn(),
      login: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error('revoke failed')),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();
    const confirm = vi.fn().mockReturnValue(true);

    const result = await performLogout({
      api,
      setStatus,
      pushToast,
      confirm,
      strings: LOGOUT_STRINGS,
    });

    expect(result).toBe(false);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'revoke failed' }),
    );
  });
});

describe('performFetchStatus', () => {
  it('updates status when the IPC resolves', async () => {
    const next = statusLoggedIn();
    const api = {
      status: vi.fn().mockResolvedValue(next),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();

    await performFetchStatus({
      api,
      setStatus,
      pushToast,
      isMounted: () => true,
      strings: STATUS_STRINGS,
    });

    expect(setStatus).toHaveBeenCalledWith(next);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('surfaces a toast and sets status to null when the IPC rejects', async () => {
    // Regression for the round-7 bot review: silently catching the status
    // fetch and rendering logged-out hides backend / keychain failures.
    // Users must see a toast so they can distinguish "not logged in" from
    // "something broke reading the login state".
    const api = {
      status: vi.fn().mockRejectedValue(new Error('IPC backend crashed')),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();

    await performFetchStatus({
      api,
      setStatus,
      pushToast,
      isMounted: () => true,
      strings: STATUS_STRINGS,
    });

    expect(setStatus).toHaveBeenCalledWith(null);
    expect(pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        title: 'status read failed',
        description: 'IPC backend crashed',
      }),
    );
  });

  it('skips setState + toast after unmount (race guard)', async () => {
    const api = {
      status: vi.fn().mockResolvedValue(statusLoggedIn()),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();

    await performFetchStatus({
      api,
      setStatus,
      pushToast,
      // User switched tabs before the IPC resolved — neither side-effect
      // should fire.
      isMounted: () => false,
      strings: STATUS_STRINGS,
    });

    expect(setStatus).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('skips setState + toast on reject after unmount', async () => {
    const api = {
      status: vi.fn().mockRejectedValue(new Error('boom')),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const setStatus = vi.fn();
    const pushToast = vi.fn();

    await performFetchStatus({
      api,
      setStatus,
      pushToast,
      isMounted: () => false,
      strings: STATUS_STRINGS,
    });

    expect(setStatus).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('uses the generic unknown-error string for non-Error rejections', async () => {
    const api = {
      status: vi.fn().mockRejectedValue('broken string'),
      login: vi.fn(),
      logout: vi.fn(),
    };
    const pushToast = vi.fn();

    await performFetchStatus({
      api,
      setStatus: vi.fn(),
      pushToast,
      isMounted: () => true,
      strings: STATUS_STRINGS,
    });

    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'unknown' }));
  });
});
