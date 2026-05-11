import { useT } from '@open-codesign/i18n';
import type { Design, LocalInputFile, OnboardingState } from '@open-codesign/shared';
import { FolderOpen, Link2, Paperclip, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';
import { AskModal } from './AskModal';
import { AddMenu } from './chat/AddMenu';
import { ChatMessageList } from './chat/ChatMessageList';
import { CommentChipBar } from './chat/CommentChipBar';
import { EmptyState } from './chat/EmptyState';
import { PromptInput, type PromptInputHandle } from './chat/PromptInput';
import { ModelSwitcher } from './ModelSwitcher';

export interface SidebarProps {
  prefillPrompt: { id: number; text: string } | null;
}

interface ComposerContextItem {
  key: string;
  label: string;
  icon: 'file' | 'url' | 'designSystem';
  actionLabel?: string;
}

export function buildComposerContextItems(input: {
  inputFiles: LocalInputFile[];
  referenceUrl: string;
  config: OnboardingState | null;
}): ComposerContextItem[] {
  const items: ComposerContextItem[] = input.inputFiles.map((file) => ({
    key: `file:${file.path}`,
    label: file.name,
    icon: 'file',
    actionLabel: file.path,
  }));

  const referenceUrl = input.referenceUrl.trim();
  if (referenceUrl.length > 0) {
    items.push({
      key: 'reference-url',
      label: referenceUrl,
      icon: 'url',
      actionLabel: referenceUrl,
    });
  }

  const designSystem = input.config?.designSystem ?? null;
  if (designSystem) {
    items.push({
      key: 'design-system',
      label: designSystem.summary,
      icon: 'designSystem',
      actionLabel: designSystem.rootPath,
    });
  }

  return items;
}

function ContextIcon({ icon }: { icon: ComposerContextItem['icon'] }) {
  if (icon === 'file') return <Paperclip className="w-3.5 h-3.5" aria-hidden />;
  if (icon === 'url') return <Link2 className="w-3.5 h-3.5" aria-hidden />;
  return <FolderOpen className="w-3.5 h-3.5" aria-hidden />;
}

function chatWorkspaceKey(workspacePath: string): string {
  return workspacePathComparisonKey(workspacePath, globalThis.navigator?.platform ?? '');
}

function chatSessionsForWorkspace(designs: Design[], currentDesign: Design): Design[] {
  if (!currentDesign.workspacePath) return [currentDesign];
  const currentWorkspaceKey = chatWorkspaceKey(currentDesign.workspacePath);
  return designs.filter(
    (design) =>
      design.workspacePath !== null &&
      chatWorkspaceKey(design.workspacePath) === currentWorkspaceKey,
  );
}

function ChatSessionTabBar() {
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
    const fallback =
      target.id === currentDesignId
        ? (chatSessions.find((design) => design.id !== target.id) ?? null)
        : null;

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

/**
 * Sidebar v2 — chat-style conversation pane.
 *
 * Replaces the single-shot prompt box with a chat history backed by the
 * session JSONL chat store. See docs/plans/2026-04-20-agentic-sidebar-
 * custom-endpoint-design.md §5 for the full spec. Multi-design switcher
 * stays deferred; the design name + "+" header shows the single current
 * design only.
 */
export function Sidebar({ prefillPrompt }: SidebarProps) {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
  const inputFiles = useCodesignStore((s) => s.inputFiles);
  const referenceUrl = useCodesignStore((s) => s.referenceUrl);
  const setReferenceUrl = useCodesignStore((s) => s.setReferenceUrl);
  const pickInputFiles = useCodesignStore((s) => s.pickInputFiles);
  const importFilesToWorkspace = useCodesignStore((s) => s.importFilesToWorkspace);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const pickDesignSystemDirectory = useCodesignStore((s) => s.pickDesignSystemDirectory);
  const clearDesignSystem = useCodesignStore((s) => s.clearDesignSystem);
  const lastUsage = useCodesignStore((s) => s.lastUsage);

  const chatMessages = useCodesignStore((s) => s.chatMessages);
  const chatLoaded = useCodesignStore((s) => s.chatLoaded);
  const streamingAssistantTextByDesign = useCodesignStore((s) => s.streamingAssistantTextByDesign);
  const pendingToolCalls = useCodesignStore((s) => s.pendingToolCalls);
  const loadChatForCurrentDesign = useCodesignStore((s) => s.loadChatForCurrentDesign);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const _sidebarCollapsed = useCodesignStore((s) => s.sidebarCollapsed);
  const _setSidebarCollapsed = useCodesignStore((s) => s.setSidebarCollapsed);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);

  const promptInputRef = useRef<PromptInputHandle>(null);
  const handlePickStarter = (starterPrompt: string): void => {
    promptInputRef.current?.setPrompt(starterPrompt);
    promptInputRef.current?.focus();
  };

  useEffect(() => {
    if (prefillPrompt === null) return;
    promptInputRef.current?.setPrompt(prefillPrompt.text);
    promptInputRef.current?.focus();
  }, [prefillPrompt]);

  const handleSubmit = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating) return;
      void sendPrompt({ prompt: trimmed });
    },
    [isGenerating, sendPrompt],
  );

  const designSystem = config?.designSystem ?? null;
  const _currentDesign = designs.find((d) => d.id === currentDesignId) ?? null;
  const contextItems = buildComposerContextItems({ inputFiles, referenceUrl, config });

  useEffect(() => {
    if (currentDesignId && !chatLoaded) {
      void loadChatForCurrentDesign();
    }
  }, [currentDesignId, chatLoaded, loadChatForCurrentDesign]);

  const _activeModelLine =
    config?.hasKey && config.modelPrimary ? config.modelPrimary : t('sidebar.chat.noModel');
  const lastTokens = lastUsage ? lastUsage.inputTokens + lastUsage.outputTokens : null;

  return (
    <aside
      className="flex flex-col h-full overflow-x-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      style={{ minHeight: 0, minWidth: 0 }}
      aria-label={t('sidebar.ariaLabel')}
    >
      <ChatSessionTabBar />

      {/* Chat scroll area */}
      <div className="codesign-scroll-area flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
        <ChatMessageList
          messages={chatMessages}
          loading={!chatLoaded}
          isGenerating={isGenerating}
          pendingToolCalls={pendingToolCalls}
          streamingText={
            currentDesignId ? (streamingAssistantTextByDesign[currentDesignId] ?? null) : null
          }
          empty={<EmptyState onPickStarter={handlePickStarter} />}
        />
        <AskModal />
      </div>

      {/* Skill chips + prompt input + model/tokens line */}
      <div className="border-t border-[var(--color-border-subtle)] px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-3)] space-y-[10px] bg-[var(--color-background-secondary)]">
        <CommentChipBar />
        <PromptInput
          ref={promptInputRef}
          onSubmit={handleSubmit}
          onCancel={cancelGeneration}
          isGenerating={isGenerating}
          onImportFiles={async (input) => {
            await importFilesToWorkspace({ ...input, attach: true });
          }}
          contextSummary={
            contextItems.length > 0 ? (
              <div className="flex flex-wrap gap-[8px]">
                {inputFiles.map((file) => (
                  <span
                    key={file.path}
                    className="inline-flex max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[11px] text-[var(--color-text-secondary)]"
                    title={file.path}
                  >
                    <ContextIcon icon="file" />
                    <span className="truncate max-w-[180px]">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeInputFile(file.path)}
                      aria-label={t('sidebar.removeFile', { name: file.name })}
                      className="inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))}
                {referenceUrl.trim() ? (
                  <span
                    className="inline-flex max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[11px] text-[var(--color-text-secondary)]"
                    title={referenceUrl.trim()}
                  >
                    <ContextIcon icon="url" />
                    <span className="truncate max-w-[220px]">{referenceUrl.trim()}</span>
                  </span>
                ) : null}
                {designSystem ? (
                  <span
                    className="inline-flex max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[11px] text-[var(--color-text-secondary)]"
                    title={designSystem.rootPath}
                  >
                    <ContextIcon icon="designSystem" />
                    <span className="truncate max-w-[220px]">{designSystem.summary}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void clearDesignSystem();
                      }}
                      aria-label={t('sidebar.clear')}
                      className="inline-flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null
          }
          leadingAction={
            <AddMenu
              onAttachFiles={() => {
                void pickInputFiles();
              }}
              onLinkDesignSystem={() => {
                void pickDesignSystemDirectory();
              }}
              referenceUrl={referenceUrl}
              onReferenceUrlChange={setReferenceUrl}
              hasDesignSystem={Boolean(designSystem)}
              disabled={isGenerating}
            />
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-2)] gap-y-[var(--space-1)] px-[2px]">
          <ModelSwitcher variant="sidebar" />
          {lastTokens !== null ? (
            <span
              className="shrink-0 tabular-nums text-[10.5px] text-[var(--color-text-muted)]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {t('sidebar.chat.tokensLine', { count: lastTokens })}
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
