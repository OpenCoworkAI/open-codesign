import { getCurrentLocale, useT, useTranslation } from '@open-codesign/i18n';
import type { LocalInputFile, OnboardingState } from '@open-codesign/shared';
import { FolderOpen, Link2, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
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
  const { i18n } = useTranslation();
  const triggerDecompose = useCodesignStore((s) => s.triggerDecompose);
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
  const sendActiveMessage = useCodesignStore((s) => s.sendActiveMessage);
  const activeMessagesByDesign = useCodesignStore((s) => s.activeMessagesByDesign);
  const recoverActiveMessage = useCodesignStore((s) => s.recoverActiveMessage);
  const activeMessages = currentDesignId ? (activeMessagesByDesign[currentDesignId] ?? []) : [];

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
      className="codesign-chat-sidebar flex flex-col h-full overflow-x-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      style={{ minHeight: 0, minWidth: 0 }}
      aria-label={t('sidebar.ariaLabel')}
    >
      {/* Header — clean, no collapse */}
      <div className="h-[var(--space-3)] shrink-0" />

      {/* Chat scroll area */}
      <div className="codesign-scroll-area min-h-0 flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
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
        <div aria-live="polite" className="space-y-[var(--space-2)]">
          {activeMessages
            .filter((message) => message.status !== 'delivered')
            .map((message) => (
              <div
                key={message.messageId}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--space-3)] text-[var(--text-sm)]"
              >
                <p className="text-[var(--color-text-secondary)]">
                  {t(message.mode === 'steer' ? 'activeMessages.steer' : 'activeMessages.queue')}
                  {' · '}
                  {t(
                    message.status === 'pending'
                      ? 'activeMessages.pending'
                      : 'activeMessages.notDelivered',
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words text-[var(--color-text-primary)]">
                  {message.text}
                </p>
                {message.reason ? (
                  <p className="text-[var(--color-text-muted)]">{message.reason}</p>
                ) : null}
                <button
                  type="button"
                  className="mt-[var(--space-2)] text-[var(--color-text-secondary)] underline"
                  onClick={() => {
                    recoverActiveMessage(message.designId, message.messageId);
                    promptInputRef.current?.focus();
                  }}
                >
                  {t('activeMessages.recover')}
                </button>
                {message.status === 'pending' ? (
                  <p className="text-[var(--color-text-muted)]">
                    {t('activeMessages.recoverPending')}
                  </p>
                ) : null}
              </div>
            ))}
        </div>
      </div>

      {/* Skill chips + prompt input + model/tokens line */}
      <div className="codesign-sidebar-composer shrink-0 border-t border-[var(--color-border-subtle)] px-[var(--space-3)] pt-[var(--space-3)] pb-[var(--space-3)] space-y-[var(--space-2)] bg-[var(--color-background-secondary)]">
        <CommentChipBar />
        <PromptInput
          ref={promptInputRef}
          onSubmit={handleSubmit}
          onActiveSubmit={sendActiveMessage}
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
                    className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[var(--text-sm)] text-[var(--color-text-secondary)]"
                    title={file.path}
                  >
                    <ContextIcon icon="file" />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeInputFile(file.path)}
                      aria-label={t('sidebar.removeFile', { name: file.name })}
                      className="inline-flex shrink-0 size-[var(--space-6)] items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))}
                {referenceUrl.trim() ? (
                  <span
                    className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[var(--text-sm)] text-[var(--color-text-secondary)]"
                    title={referenceUrl.trim()}
                  >
                    <ContextIcon icon="url" />
                    <span className="min-w-0 truncate">{referenceUrl.trim()}</span>
                  </span>
                ) : null}
                {designSystem ? (
                  <span
                    className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[10px] py-[5px] text-[var(--text-sm)] text-[var(--color-text-secondary)]"
                    title={designSystem.rootPath}
                  >
                    <ContextIcon icon="designSystem" />
                    <span className="min-w-0 truncate">{designSystem.summary}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void clearDesignSystem();
                      }}
                      aria-label={t('sidebar.clear')}
                      className="inline-flex shrink-0 size-[var(--space-6)] items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
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
              onDecomposeToUiKit={
                currentDesignId
                  ? () => {
                      triggerDecompose(currentDesignId, i18n.language || getCurrentLocale());
                    }
                  : undefined
              }
              canDecompose={Boolean(currentDesignId) && !isGenerating}
            />
          }
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--space-2)] px-[2px]">
          <ModelSwitcher variant="sidebar" />
          {lastTokens !== null ? (
            <span
              className="shrink-0 tabular-nums text-[var(--text-sm)] text-[var(--color-text-muted)]"
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
