import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';

export function chatSessionsForWorkspace(designs: Design[], currentDesign: Design): Design[] {
  if (!currentDesign.workspacePath) return [currentDesign];
  const currentWorkspaceKey = workspacePathComparisonKey(currentDesign.workspacePath);
  return designs.filter(
    (design) =>
      design.workspacePath !== null &&
      workspacePathComparisonKey(design.workspacePath) === currentWorkspaceKey,
  );
}

export function fallbackChatAfterClose(
  chatSessions: Design[],
  currentDesignId: string | null,
  targetId: string,
): Design | null {
  if (targetId !== currentDesignId) return null;
  return chatSessions.find((design) => design.id !== targetId) ?? null;
}

export function ChatSessionTabBar() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const softDeleteDesign = useCodesignStore((s) => s.softDeleteDesign);
  const createNewConversationForCurrentWorkspace = useCodesignStore(
    (s) => s.createNewConversationForCurrentWorkspace,
  );
  const [creating, setCreating] = useState(false);
  const [conversationToClose, setConversationToClose] = useState<Design | null>(null);
  const currentDesign = designs.find((design) => design.id === currentDesignId) ?? null;
  if (currentDesign === null) return null;

  const chatSessions = chatSessionsForWorkspace(designs, currentDesign);
  const canCreate = currentDesign.workspacePath !== null;

  async function handleNewChat() {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await createNewConversationForCurrentWorkspace();
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmCloseChat() {
    if (conversationToClose === null) return;
    const target = conversationToClose;
    const fallback = fallbackChatAfterClose(chatSessions, currentDesignId, target.id);

    setConversationToClose(null);
    if (fallback !== null) {
      await switchDesign(fallback.id);
    }
    await softDeleteDesign(target.id);
  }

  return (
    <>
      <div className="shrink-0 border-b border-[var(--color-border-muted)] bg-[var(--color-background-secondary)] pl-[var(--space-2)]">
        <div className="flex min-w-0 items-stretch">
          {canCreate ? (
            <button
              type="button"
              onClick={() => void handleNewChat()}
              disabled={creating}
              title={t('projects.switcher.newConversationForWorkspace')}
              aria-label={t('projects.switcher.newConversationForWorkspace')}
              className="my-[6px] mr-[var(--space-1)] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <div
            role="tablist"
            aria-label={t('sidebar.chatTabsAriaLabel')}
            className="codesign-scroll-x flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
          >
            {chatSessions.map((design) => {
              const isActive = design.id === currentDesignId;
              return (
                <div
                  key={design.id}
                  role="tab"
                  aria-selected={isActive}
                  className={`group relative flex shrink-0 items-center gap-[var(--space-2)] rounded-t-[var(--radius-sm)] px-[var(--space-3)] py-[7px] text-[12px] transition-colors duration-[var(--duration-faster)] ${
                    isActive
                      ? 'border-x border-[var(--color-border-muted)] bg-[var(--color-background)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!isActive) void switchDesign(design.id);
                    }}
                    title={design.name}
                    className="flex items-center gap-[var(--space-1_5)] focus:outline-none"
                  >
                    <span className="max-w-[160px] truncate">{design.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversationToClose(design)}
                    aria-label={t('sidebar.closeChat', { name: design.name })}
                    className="p-[2px] text-[var(--color-text-muted)] opacity-50 transition-opacity hover:text-[var(--color-text-primary)] hover:opacity-100"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-[var(--space-2)] bottom-[-1px] h-[1.5px] bg-[var(--color-accent)]"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {conversationToClose ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('sidebar.deleteChat.title')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConversationToClose(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConversationToClose(null);
          }}
        >
          <div
            role="document"
            className="w-full max-w-sm rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-[var(--shadow-elevated)] space-y-4 animate-[panel-in_160ms_ease-out]"
          >
            <h3 className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
              {t('sidebar.deleteChat.title')}
            </h3>
            <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
              {t('sidebar.deleteChat.body', { name: conversationToClose.name })}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConversationToClose(null)}
                className="h-9 rounded-[var(--radius-md)] px-3 text-[var(--text-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                {t('sidebar.deleteChat.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCloseChat()}
                className="h-9 rounded-[var(--radius-md)] bg-[var(--color-error)] px-3 text-[var(--text-sm)] font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90"
              >
                {t('sidebar.deleteChat.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
