import { useT } from '@open-codesign/i18n';
import { Button } from '@open-codesign/ui';
import { Loader2, LogOut, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexOAuthStatus } from '../../../preload/index';
import { useCodesignStore } from '../store';

export interface ChatgptLoginCardProps {
  /** Called after a successful login or logout so the parent can refresh its provider list. */
  onStatusChange?: () => void | Promise<void>;
}

export type ChatgptViewState = 'not-logged-in' | 'loading' | 'logged-in';

export function resolveViewState(
  status: CodexOAuthStatus | null,
  loading: boolean,
): ChatgptViewState {
  if (loading) return 'loading';
  if (status?.loggedIn) return 'logged-in';
  return 'not-logged-in';
}

interface CodexOAuthApi {
  status(): Promise<CodexOAuthStatus>;
  login(): Promise<CodexOAuthStatus>;
  logout(): Promise<CodexOAuthStatus>;
}

type PushToastLike = (toast: { variant: 'error'; title: string; description?: string }) => unknown;

export interface PerformLoginDeps {
  api: CodexOAuthApi;
  setStatus: (s: CodexOAuthStatus) => void;
  setLoading: (v: boolean) => void;
  pushToast: PushToastLike;
  onStatusChange?: () => void | Promise<void>;
  strings: { failedTitle: string; unknownError: string };
}

export async function performLogin(deps: PerformLoginDeps): Promise<void> {
  deps.setLoading(true);
  try {
    const next = await deps.api.login();
    deps.setStatus(next);
    await deps.onStatusChange?.();
  } catch (err) {
    deps.pushToast({
      variant: 'error',
      title: deps.strings.failedTitle,
      description: err instanceof Error ? err.message : deps.strings.unknownError,
    });
  } finally {
    deps.setLoading(false);
  }
}

export interface PerformLogoutDeps {
  api: CodexOAuthApi;
  setStatus: (s: CodexOAuthStatus) => void;
  pushToast: PushToastLike;
  confirm: (message: string) => boolean;
  onStatusChange?: () => void | Promise<void>;
  strings: { confirmMessage: string; failedTitle: string; unknownError: string };
}

export async function performLogout(deps: PerformLogoutDeps): Promise<boolean> {
  if (!deps.confirm(deps.strings.confirmMessage)) return false;
  try {
    const next = await deps.api.logout();
    deps.setStatus(next);
    await deps.onStatusChange?.();
    return true;
  } catch (err) {
    deps.pushToast({
      variant: 'error',
      title: deps.strings.failedTitle,
      description: err instanceof Error ? err.message : deps.strings.unknownError,
    });
    return false;
  }
}

export interface PerformFetchStatusDeps {
  api: CodexOAuthApi;
  setStatus: (s: CodexOAuthStatus | null) => void;
  pushToast: PushToastLike;
  /**
   * Mount guard — the caller passes a `() => boolean` snapshot so we never
   * setState on an unmounted component. Surfaces the same toast pattern as
   * performLogin/performLogout so a failing boot-time status fetch isn't
   * silently misrendered as "logged out".
   */
  isMounted: () => boolean;
  strings: { failedTitle: string; unknownError: string };
}

export async function performFetchStatus(deps: PerformFetchStatusDeps): Promise<void> {
  try {
    const s = await deps.api.status();
    if (deps.isMounted()) deps.setStatus(s);
  } catch (err) {
    if (!deps.isMounted()) return;
    deps.setStatus(null);
    deps.pushToast({
      variant: 'error',
      title: deps.strings.failedTitle,
      description: err instanceof Error ? err.message : deps.strings.unknownError,
    });
  }
}

export function ChatgptLoginCard({ onStatusChange }: ChatgptLoginCardProps) {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [status, setStatus] = useState<CodexOAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!window.codesign) return;
    void performFetchStatus({
      api: window.codesign.codexOAuth,
      setStatus,
      pushToast,
      isMounted: () => mountedRef.current,
      strings: {
        failedTitle: t('settings.providers.chatgptLogin.statusFailedTitle'),
        unknownError: t('settings.providers.chatgptLogin.unknownError'),
      },
    });
  }, [pushToast, t]);

  const handleLogin = useCallback(async () => {
    if (!window.codesign) return;
    await performLogin({
      api: window.codesign.codexOAuth,
      setStatus: (s) => {
        if (mountedRef.current) setStatus(s);
      },
      setLoading: (v) => {
        if (mountedRef.current) setLoading(v);
      },
      pushToast,
      strings: {
        failedTitle: t('settings.providers.chatgptLogin.loginFailedTitle'),
        unknownError: t('settings.providers.chatgptLogin.unknownError'),
      },
      ...(onStatusChange !== undefined ? { onStatusChange } : {}),
    });
  }, [onStatusChange, pushToast, t]);

  const handleLogout = useCallback(async () => {
    if (!window.codesign) return;
    await performLogout({
      api: window.codesign.codexOAuth,
      setStatus: (s) => {
        if (mountedRef.current) setStatus(s);
      },
      pushToast,
      confirm: (message) => window.confirm(message),
      strings: {
        confirmMessage: t('settings.providers.chatgptLogin.confirmLogout'),
        failedTitle: t('settings.providers.chatgptLogin.logoutFailedTitle'),
        unknownError: t('settings.providers.chatgptLogin.unknownError'),
      },
      ...(onStatusChange !== undefined ? { onStatusChange } : {}),
    });
  }, [onStatusChange, pushToast, t]);

  const viewState = resolveViewState(status, loading);

  if (viewState === 'logged-in' && status) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-center gap-[var(--space-3)]">
        <div className="min-w-0 flex-1 flex items-center gap-[var(--space-2)] flex-wrap">
          <span className="inline-flex items-center gap-[var(--space-1)] px-[var(--space-1_5)] py-[var(--space-0_5)] rounded-full border border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent text-[var(--font-size-badge)] font-medium leading-none">
            <Sparkles className="w-[var(--size-icon-xs)] h-[var(--size-icon-xs)]" />
            {t('settings.providers.chatgptLogin.loggedInBadge')}
          </span>
          {status.email !== null && status.email.length > 0 && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
              {status.email}
            </span>
          )}
        </div>
        <div className="shrink-0">
          <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
            <LogOut className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" />
            {t('settings.providers.chatgptLogin.logout')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-start gap-[var(--space-3)]">
      <div className="min-w-0 flex-1">
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
          {t('settings.providers.chatgptLogin.title')}
        </div>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-[var(--space-0_5)] leading-[var(--leading-body)]">
          {t('settings.providers.chatgptLogin.description')}
        </p>
      </div>
      <div className="shrink-0">
        {viewState === 'loading' ? (
          <Button variant="primary" size="sm" disabled>
            <Loader2 className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] animate-spin" />
            {t('settings.providers.chatgptLogin.inProgress')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void handleLogin()}>
            <Sparkles className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" />
            {t('settings.providers.chatgptLogin.signIn')}
          </Button>
        )}
      </div>
    </div>
  );
}
