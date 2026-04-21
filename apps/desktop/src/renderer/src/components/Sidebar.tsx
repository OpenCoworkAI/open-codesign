import { useT } from '@open-codesign/i18n';
import { useEffect, useRef, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream';
import { getInputFileKey, useCodesignStore } from '../store';
import { ModelSwitcher } from './ModelSwitcher';
import { RemotePathModal } from './RemotePathModal';
import { AddMenu } from './chat/AddMenu';
import { ChatMessageList } from './chat/ChatMessageList';
import { CommentChipBar } from './chat/CommentChipBar';
import { EmptyState } from './chat/EmptyState';
import { PromptInput, type PromptInputHandle } from './chat/PromptInput';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

/**
 * Sidebar v2 - chat-style conversation pane.
 *
 * Replaces the single-shot prompt box with a chat history backed by the
 * chat_messages SQLite table. See docs/plans/2026-04-20-agentic-sidebar-
 * custom-endpoint-design.md section 5 for the full spec. Multi-design switcher
 * stays deferred; the design name + "+" header shows the single current
 * design only.
 */
export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
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
  const attachRemoteFile = useCodesignStore((s) => s.attachRemoteFile);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const pickDesignSystemDirectory = useCodesignStore((s) => s.pickDesignSystemDirectory);
  const linkRemoteDesignSystem = useCodesignStore((s) => s.linkRemoteDesignSystem);
  const clearDesignSystem = useCodesignStore((s) => s.clearDesignSystem);
  const lastUsage = useCodesignStore((s) => s.lastUsage);

  const chatMessages = useCodesignStore((s) => s.chatMessages);
  const chatLoaded = useCodesignStore((s) => s.chatLoaded);
  const streamingAssistantText = useCodesignStore((s) => s.streamingAssistantText);
  const pendingToolCalls = useCodesignStore((s) => s.pendingToolCalls);
  const loadChatForCurrentDesign = useCodesignStore((s) => s.loadChatForCurrentDesign);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const [showRemoteFileModal, setShowRemoteFileModal] = useState(false);
  const [showRemoteDesignSystemModal, setShowRemoteDesignSystemModal] = useState(false);

  // Mount useAgentStream here so streaming events route into the chat
  // as soon as the Sidebar is in the tree - matches the lifecycle of
  // chat visibility without needing an app-level hook.
  useAgentStream();

  const promptInputRef = useRef<PromptInputHandle>(null);
  const handlePickStarter = (starterPrompt: string): void => {
    setPrompt(starterPrompt);
    promptInputRef.current?.focus();
  };

  const designSystem = config?.designSystem ?? null;
  const sshProfiles = config?.sshProfiles ?? [];
  const hasRemoteProfiles = sshProfiles.length > 0;

  useEffect(() => {
    if (currentDesignId && !chatLoaded) {
      void loadChatForCurrentDesign();
    }
  }, [currentDesignId, chatLoaded, loadChatForCurrentDesign]);

  const activeModelLine =
    config?.hasKey && config.modelPrimary ? config.modelPrimary : t('sidebar.chat.noModel');
  const lastTokens = lastUsage ? lastUsage.inputTokens + lastUsage.outputTokens : null;

  return (
    <aside
      className="flex flex-col h-full overflow-x-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      style={{ minHeight: 0, minWidth: 0 }}
      aria-label={t('sidebar.ariaLabel')}
    >
      {/* Header - clean, no collapse */}
      <div className="h-[var(--space-3)] shrink-0" />

      <>
        {/* Chat scroll area */}
        <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
          <ChatMessageList
            messages={chatMessages}
            loading={!chatLoaded}
            isGenerating={isGenerating}
            pendingToolCalls={pendingToolCalls}
            streamingText={
              streamingAssistantText && streamingAssistantText.designId === currentDesignId
                ? streamingAssistantText.text
                : null
            }
            empty={<EmptyState onPickStarter={handlePickStarter} />}
          />
        </div>

        {/* Skill chips + prompt input + model/tokens line */}
        <div className="border-t border-[var(--color-border-subtle)] px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-3)] space-y-[10px] bg-[var(--color-background-secondary)]">
          <CommentChipBar />
          <PromptInput
            ref={promptInputRef}
            prompt={prompt}
            setPrompt={setPrompt}
            onSubmit={onSubmit}
            onCancel={cancelGeneration}
            isGenerating={isGenerating}
            leadingAction={
              <AddMenu
                onAttachFiles={() => void pickInputFiles()}
                onAttachRemoteFile={() => setShowRemoteFileModal(true)}
                onLinkDesignSystem={() => void pickDesignSystemDirectory()}
                onLinkRemoteDesignSystem={() => setShowRemoteDesignSystemModal(true)}
                referenceUrl={referenceUrl}
                onReferenceUrlChange={setReferenceUrl}
                hasDesignSystem={designSystem !== null}
                hasRemoteProfiles={hasRemoteProfiles}
                disabled={isGenerating}
              />
            }
          />
          {inputFiles.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {inputFiles.map((file) => (
                <button
                  key={getInputFileKey(file)}
                  type="button"
                  onClick={() => removeInputFile(getInputFileKey(file))}
                  className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  title={file.kind === 'ssh' ? (file.displayPath ?? file.path) : file.path}
                >
                  <span className="truncate">
                    {file.kind === 'ssh' ? `SSH: ${file.name}` : file.name}
                  </span>
                  <span aria-hidden>x</span>
                </button>
              ))}
            </div>
          ) : null}
          {designSystem ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-[var(--color-text-primary)]">
                    {designSystem.sourceKind === 'ssh' ? '远程设计系统' : '设计系统'}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-text-muted)]">
                    {designSystem.sourceKind === 'ssh' && designSystem.sshHost
                      ? `${designSystem.sshUsername}@${designSystem.sshHost}:${designSystem.rootPath}`
                      : designSystem.rootPath}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void clearDesignSystem()}
                  className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {t('sidebar.clear')}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-[var(--space-2)] px-[2px]">
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
      </>
      {showRemoteFileModal ? (
        <RemotePathModal
          title="添加远程文件"
          actionLabel="添加"
          pathLabel="远程文件路径"
          profiles={sshProfiles}
          description="输入服务器上的完整文件路径，或相对于当前 Profile 默认根路径的路径。"
          onClose={() => setShowRemoteFileModal(false)}
          onConfirm={(profileId, path) => attachRemoteFile(profileId, path)}
        />
      ) : null}
      {showRemoteDesignSystemModal ? (
        <RemotePathModal
          title="关联远程设计系统"
          actionLabel="关联"
          pathLabel="远程目录路径"
          profiles={sshProfiles}
          description="选择一个已保存的 SSH Profile，并填写远程仓库或设计系统目录。"
          onClose={() => setShowRemoteDesignSystemModal(false)}
          onConfirm={(profileId, path) => linkRemoteDesignSystem(profileId, path)}
        />
      ) : null}
    </aside>
  );
}
