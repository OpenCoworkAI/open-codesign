import type {
  ChatAppendInput,
  ChatMessageRow,
  ChatToolCallPayload,
  CommentKind,
  CommentRect,
  CommentRow,
  CommentScope,
  Design,
  DiagnosticEventRow,
  LocalInputFile,
  OnboardingState,
  ReportableError,
  ReportEventInput,
  ReportEventResult,
  SelectedElement,
} from '@open-codesign/shared';
import { create } from 'zustand';
import type { CodesignApi, ExportFormat } from '../../preload/index';
import { recordAction } from './lib/action-timeline';
import { tr, uniqueFiles } from './store/lib/locale';
import { makeChatSlice } from './store/slices/chat';
import { makeCommentsSlice } from './store/slices/comments';
import { makeDesignsSlice } from './store/slices/designs';
import { makeDiagnosticsSlice } from './store/slices/diagnostics';
import {
  type CreateReportableErrorInput,
  extractCodesignErrorCode,
  extractUpstreamContext,
  MAX_REPORTABLE,
  type ReportableErrorToastSpec,
  type Toast,
  type ToastVariant,
} from './store/slices/errors';
import {
  applyGenerateBaseUrlFix,
  buildEnrichedPrompt,
  type GenerationStage,
  makeGenerationSlice,
  type PendingEditEnrichment,
} from './store/slices/generation';
import { toSnapshotArtifactType } from './store/slices/snapshots';
import { type CanvasTab, closeTabAt, FILES_TAB, openFileTab } from './store/slices/tabs';
import { applyThemeClass, persistTheme, readInitialTheme, type Theme } from './store/slices/theme';
import { coerceUsageSnapshot, type UsageSnapshot } from './store/slices/usage';

declare global {
  interface Window {
    codesign?: CodesignApi;
  }
}

export type {
  CanvasTab,
  CreateReportableErrorInput,
  GenerationStage,
  PendingEditEnrichment,
  ReportableErrorToastSpec,
  Theme,
  Toast,
  ToastVariant,
  UsageSnapshot,
};
// Re-exports so existing `import { ... } from './store'` call sites keep working
// without reaching into the slice modules directly.
export {
  applyGenerateBaseUrlFix,
  buildEnrichedPrompt,
  closeTabAt,
  coerceUsageSnapshot,
  extractCodesignErrorCode,
  extractUpstreamContext,
  FILES_TAB,
  MAX_REPORTABLE,
  openFileTab,
  toSnapshotArtifactType,
};

export type AppView = 'hub' | 'workspace' | 'settings';
export type SettingsTab = 'models' | 'appearance' | 'storage' | 'diagnostics' | 'advanced';
export type HubTab = 'recent' | 'your' | 'examples' | 'designSystems';
export type InteractionMode = 'default' | 'comment';
export type PreviewViewport = 'desktop' | 'tablet' | 'mobile';

export interface CommentBubbleAnchor {
  selector: string;
  tag: string;
  outerHTML: string;
  rect: CommentRect;
  /** v2 enrichment — parent element outerHTML, truncated. */
  parentOuterHTML?: string;
  /** If set, the bubble is editing an existing saved comment. */
  existingCommentId?: string;
  initialText?: string;
  initialScope?: CommentScope;
}

export interface CodesignState {
  previewHtml: string | null;
  /** LRU cache of `previewHtml` per design id, capped to PREVIEW_POOL_LIMIT.
   *  PreviewPane renders one (display:none) iframe per entry so switching back
   *  to a recently visited design is instant — no IPC, no srcDoc reparse. */
  previewHtmlByDesign: Record<string, string>;
  /** Most-recent-first list of design ids in the preview pool. */
  recentDesignIds: string[];
  isGenerating: boolean;
  activeGenerationId: string | null;
  /** Design id that owns the in-flight generation. Lets the user switch to
   *  another design while a generation runs (it stays bound to its origin
   *  design via designIdAtStart) — UI only shows "generating" affordances on
   *  the design that actually has the run. */
  generatingDesignId: string | null;
  generationStage: GenerationStage;
  /** Live assistant text buffered during the current agent turn. Rendered as
   *  an ephemeral chat bubble so the UI shows incremental output instead of
   *  waiting for the turn to settle. Cleared on turn_end (the persisted
   *  chat row takes over). */
  streamingAssistantText: { designId: string; text: string } | null;
  lastUsage: UsageSnapshot | null;
  errorMessage: string | null;
  lastError: string | null;
  config: OnboardingState | null;
  configLoaded: boolean;
  toastMessage: string | null;

  designs: Design[];
  currentDesignId: string | null;
  designsLoaded: boolean;
  designsViewOpen: boolean;
  newDesignDialogOpen: boolean;
  designToDelete: Design | null;
  designToRename: Design | null;
  /** Workspace rebind confirmation state: { design, newPath } when user picks a different folder */
  workspaceRebindPending: { design: Design; newPath: string } | null;

  theme: Theme;
  view: AppView;
  previousView: AppView;
  /** When non-null, Settings reads this on mount to auto-select the tab
   *  then calls clearSettingsTab() so future opens are unbiased. */
  settingsTab: SettingsTab | null;
  hubTab: HubTab;
  previewViewport: PreviewViewport;
  toasts: Toast[];
  iframeErrors: string[];

  inputFiles: LocalInputFile[];
  referenceUrl: string;
  lastPromptInput: {
    prompt: string;
    attachments: LocalInputFile[];
    referenceUrl?: string | undefined;
  } | null;
  selectedElement: SelectedElement | null;
  previewZoom: number;
  interactionMode: InteractionMode;

  // Sidebar v2 chat state
  chatMessages: ChatMessageRow[];
  chatLoaded: boolean;
  /** In-flight tool calls that haven't completed yet. Purely in-memory —
   *  only persisted to SQLite when the result arrives (done/error). */
  pendingToolCalls: ChatToolCallPayload[];
  sidebarCollapsed: boolean;

  // Workstream D — comments
  comments: CommentRow[];
  commentsLoaded: boolean;
  commentBubble: CommentBubbleAnchor | null;
  /** Id of the snapshot currently visible in the preview — pins filter by it. */
  currentSnapshotId: string | null;
  /** Live, iframe-viewport-relative rects keyed by selector. Updated on
   *  every iframe scroll/resize so pins and bubbles track their anchor
   *  element even when the design scrolls inside the sandbox. Consumers
   *  prefer this over the stored rect when present. Unscaled — callers
   *  apply zoom themselves. */
  liveRects: Record<string, CommentRect>;

  // Workstream G — canvas file tabs
  canvasTabs: CanvasTab[];
  activeCanvasTab: number;

  // PR4 — diagnostics slice. Pull-based: Diagnostics panel + error UI call
  // `refreshDiagnosticEvents` on mount / when a failure surfaces. No polling.
  recentEvents: DiagnosticEventRow[];
  unreadErrorCount: number;
  /** Timestamp of the last time the user opened the Diagnostics panel.
   *  `unreadErrorCount` counts error-level events whose `ts > lastReadTs`. */
  lastReadTs: number;
  /** Guard so we only hydrate `lastReadTs` from persisted preferences once
   *  per session — first `refreshDiagnosticEvents` call does the read. */
  diagnosticsPrefsHydrated: boolean;
  refreshDiagnosticEvents: () => Promise<void>;
  markDiagnosticsRead: () => void;
  reportDiagnosticEvent: (
    input: Omit<ReportEventInput, 'schemaVersion' | 'timeline' | 'error'> & {
      error: ReportableError;
    },
  ) => Promise<ReportEventResult>;

  /**
   * Canonical in-memory registry of every error the renderer has surfaced to
   * the user. Capped at MAX_REPORTABLE; oldest entries drop first. The Report
   * dialog reads from here directly so it opens instantly, without an IPC
   * round-trip to the diagnostic_events DB.
   */
  reportableErrors: ReportableError[];
  /**
   * Register a ReportableError in-memory (synchronous) and kick off a fire-
   * and-forget `recordRendererError` IPC to persist it into diagnostic_events.
   * Returns the newly minted `localId` so callers can stamp it on the toast
   * or dialog invocation.
   */
  createReportableError: (partial: CreateReportableErrorInput) => string;
  getReportableError: (localId: string) => ReportableError | undefined;

  /** localId of the ReportableError whose Report dialog is currently open, or
   *  null if no dialog is active. Hoisted to the store so only one dialog
   *  ever mounts — multiple error toasts can't stack overlapping modals. */
  activeReportLocalId: string | null;
  openReportDialog: (localId: string) => void;
  closeReportDialog: () => void;

  loadConfig: () => Promise<void>;
  completeOnboarding: (next: OnboardingState) => void;
  sendPrompt: (input: {
    prompt: string;
    attachments?: LocalInputFile[] | undefined;
    referenceUrl?: string | undefined;
    /** Silent prompts skip the user chat bubble and the auto-rename trigger.
     *  Used by the auto-polish flow so the injected "deepen" request isn't
     *  visible as a user message — the agent still receives it and responds
     *  normally, but the chat transcript reads as one continuous run. */
    silent?: boolean | undefined;
  }) => Promise<void>;
  /** Feature flag for the auto-polish second-loop injection. When true,
   *  `tryAutoPolish` fires a canned "deepen this design" follow-up after the
   *  first successful run of a design. Set to false for now because the
   *  second round doubles run time and the gain isn't worth the wait while
   *  context management is still settling. Flip back to true once polish
   *  runs are faster / cheaper. Can also be toggled at runtime via
   *  `useCodesignStore.setState({ autoPolishEnabled: true })` from devtools. */
  autoPolishEnabled: boolean;
  autoPolishFired: Set<string>;
  /** Fire the canned "deepen this design" follow-up prompt once per design,
   *  if the condition is met (first round succeeded, no prior polish). Call
   *  from useAgentStream's agent_end handler. */
  tryAutoPolish: (designId: string, locale: string) => void;
  cancelGeneration: () => void;
  retryLastPrompt: () => Promise<void>;
  applyInlineComment: (comment: string) => Promise<void>;
  clearError: () => void;
  clearIframeErrors: () => void;
  pushIframeError: (message: string) => void;
  exportActive: (format: ExportFormat) => Promise<void>;

  pickInputFiles: () => Promise<void>;
  removeInputFile: (path: string) => void;
  clearInputFiles: () => void;
  setReferenceUrl: (value: string) => void;
  pickDesignSystemDirectory: () => Promise<void>;
  clearDesignSystem: () => Promise<void>;

  selectCanvasElement: (selection: SelectedElement) => void;
  clearCanvasElement: () => void;
  setPreviewZoom: (zoom: number) => void;
  setInteractionMode: (mode: InteractionMode) => void;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setView: (view: AppView) => void;
  /** Open Settings and select a specific tab. Used by the topbar unread-error
   *  badge to jump straight to the Diagnostics panel. Setting to null clears
   *  the hint (Settings falls back to its own default tab). */
  openSettingsTab: (tab: SettingsTab) => void;
  clearSettingsTab: () => void;
  setHubTab: (tab: HubTab) => void;
  setPreviewViewport: (viewport: PreviewViewport) => void;

  loadDesigns: () => Promise<void>;
  ensureCurrentDesign: () => Promise<void>;
  openNewDesignDialog: () => void;
  closeNewDesignDialog: () => void;
  createNewDesign: (workspacePath?: string | null) => Promise<Design | null>;
  switchDesign: (id: string) => Promise<void>;
  renameCurrentDesign: (name: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  duplicateDesign: (id: string) => Promise<Design | null>;
  softDeleteDesign: (id: string) => Promise<void>;
  openDesignsView: () => void;
  closeDesignsView: () => void;
  requestDeleteDesign: (design: Design | null) => void;
  requestRenameDesign: (design: Design | null) => void;

  requestWorkspaceRebind: (design: Design, newPath: string) => void;
  cancelWorkspaceRebind: () => void;
  confirmWorkspaceRebind: (migrateFiles: boolean) => Promise<void>;

  pushToast: (toast: Omit<Toast, 'id'>) => string;
  /**
   * Convenience wrapper that pairs `createReportableError` with `pushToast`
   * so callers don't have to stitch them together. Prefer this over raw
   * `pushToast({ variant: 'error', ... })` at any site where a meaningful
   * `code` + `scope` can be supplied — the Report dialog then gets real
   * triage fields instead of the generic RENDERER_ERROR / renderer pair
   * that `pushToast`'s auto-wrap falls back to.
   */
  reportableErrorToast: (spec: ReportableErrorToastSpec) => string;
  dismissToast: (id?: string) => void;

  // Sidebar v2 chat actions
  loadChatForCurrentDesign: () => Promise<void>;
  appendChatMessage: (input: ChatAppendInput) => Promise<ChatMessageRow | null>;
  clearChatLocal: () => void;
  setStreamingAssistantText: (value: { designId: string; text: string } | null) => void;
  pushPendingToolCall: (designId: string, call: ChatToolCallPayload) => void;
  resolvePendingToolCall: (
    designId: string,
    toolName: string,
    result?: string,
    durationMs?: number,
  ) => void;
  /** Patch a persisted tool_call row's status and merge into local state.
   *  Called when the agent's tool_call_result event lands after the row was
   *  already inserted as 'running' at tool_call_start time. */
  updateChatToolStatus: (input: {
    designId: string;
    seq: number;
    status: 'done' | 'error';
    result?: unknown;
    durationMs?: number;
    errorMessage?: string;
  }) => Promise<void>;
  /** Live preview update from the agent's virtual fs edit tool.
   *  Gated by designId match against the active or generating design so a
   *  background run cannot stomp the preview the user is currently viewing. */
  setPreviewHtmlFromAgent: (input: { designId: string; content: string }) => void;
  /** Persist the current in-memory `previewHtml` for a finished agentic run as
   *  a SQLite snapshot row. Without this, agentic runs never write to disk
   *  and reload boots back into the empty welcome state even when the agent
   *  produced a valid index.html. Fires-and-forgets — failures are toasted. */
  persistAgentRunSnapshot: (input: { designId: string; finalText?: string }) => Promise<void>;
  /** Replace the current preview source verbatim. Used by the host's tweak
   *  panel to write a re-serialized EDITMODE block back into the artifact. */
  setPreviewHtml: (content: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Workstream D — comments
  loadCommentsForCurrentDesign: () => Promise<void>;
  openCommentBubble: (anchor: CommentBubbleAnchor) => void;
  closeCommentBubble: () => void;
  addComment: (input: {
    kind: CommentKind;
    selector: string;
    tag: string;
    outerHTML: string;
    rect: CommentRect;
    text: string;
    scope?: CommentScope;
    parentOuterHTML?: string;
  }) => Promise<CommentRow | null>;
  updateComment: (id: string, patch: { text?: string }) => Promise<CommentRow | null>;
  /** Single entry point used by CommentBubble. If `existingCommentId` is set,
   *  routes to updateComment (editing a saved comment); otherwise addComment
   *  (creating a new one). Returns the resulting row on success, null on
   *  failure — callers must check before closing UI so drafts aren't lost. */
  submitComment: (input: {
    existingCommentId?: string;
    kind: CommentKind;
    selector: string;
    tag: string;
    outerHTML: string;
    rect: CommentRect;
    text: string;
    scope?: CommentScope;
    parentOuterHTML?: string;
  }) => Promise<CommentRow | null>;
  removeComment: (id: string) => Promise<void>;
  /** Replace the live rects map — called from PreviewPane when the sandbox
   *  broadcasts an ELEMENT_RECTS message. Entries are iframe-viewport-relative
   *  and unscaled. */
  applyLiveRects: (entries: Array<{ selector: string; rect: CommentRect }>) => void;
  /** Reset live rects — call on design/snapshot switch to avoid stale
   *  overlays pointing at the previous iframe's layout. */
  clearLiveRects: () => void;

  // Workstream G — canvas file tabs
  openCanvasFileTab: (path: string) => void;
  closeCanvasTab: (index: number) => void;
  setActiveCanvasTab: (index: number) => void;
  resetCanvasTabs: () => void;
}

export const useCodesignStore = create<CodesignState>((set, get) => ({
  // ---- initial state ----
  previewHtml: null,
  previewHtmlByDesign: {},
  recentDesignIds: [],
  isGenerating: false,
  activeGenerationId: null,
  generatingDesignId: null,
  generationStage: 'idle' as GenerationStage,
  streamingAssistantText: null,
  pendingToolCalls: [],
  lastUsage: null,
  errorMessage: null,
  lastError: null,
  config: null,
  configLoaded: false,
  toastMessage: null,
  autoPolishEnabled: false,
  autoPolishFired: new Set<string>(),

  theme: readInitialTheme(),
  view: 'hub' as AppView,
  previousView: 'hub' as AppView,
  settingsTab: null as SettingsTab | null,
  hubTab: 'recent' as HubTab,
  previewViewport: 'desktop' as PreviewViewport,
  toasts: [],
  iframeErrors: [],

  designs: [],
  currentDesignId: null,
  designsLoaded: false,
  designsViewOpen: false,
  newDesignDialogOpen: false,
  designToDelete: null,
  designToRename: null,
  workspaceRebindPending: null,

  inputFiles: [],
  referenceUrl: '',
  lastPromptInput: null,
  selectedElement: null,
  previewZoom: 100,
  interactionMode: 'default' as InteractionMode,

  chatMessages: [],
  chatLoaded: false,
  sidebarCollapsed: false,

  comments: [],
  commentsLoaded: false,
  commentBubble: null,
  currentSnapshotId: null,
  liveRects: {},

  canvasTabs: [FILES_TAB],
  activeCanvasTab: 0,

  recentEvents: [],
  unreadErrorCount: 0,
  lastReadTs: 0,
  diagnosticsPrefsHydrated: false,
  reportableErrors: [],
  activeReportLocalId: null,

  // ---- slice-owned actions ----
  ...makeDiagnosticsSlice(set, get),
  ...makeGenerationSlice(set, get),
  ...makeDesignsSlice(set, get),
  ...makeChatSlice(set, get),
  ...makeCommentsSlice(set, get),

  // ---- inline simple actions ----
  clearIframeErrors() {
    set({ iframeErrors: [] });
  },

  pushIframeError(message) {
    set((s) => {
      const last = s.iframeErrors[s.iframeErrors.length - 1];
      if (last === message) return {};
      const next = [...s.iframeErrors, message];
      return { iframeErrors: next.length > 50 ? next.slice(1) : next };
    });
  },

  async loadConfig() {
    if (!window.codesign) {
      set({
        configLoaded: true,
        errorMessage: tr('errors.rendererDisconnected'),
      });
      return;
    }
    const state = await window.codesign.onboarding.getState();
    set({ config: state, configLoaded: true });
    if (state.hasKey) {
      await get().ensureCurrentDesign();
    }
  },

  completeOnboarding(next: OnboardingState) {
    recordAction({ type: 'onboarding.complete' });
    set({ config: next });
  },

  async pickInputFiles() {
    if (!window.codesign) return;
    const files = await window.codesign.pickInputFiles();
    if (files.length === 0) return;
    set((s) => ({ inputFiles: uniqueFiles([...s.inputFiles, ...files]) }));
  },

  removeInputFile(path) {
    set((s) => ({ inputFiles: s.inputFiles.filter((file) => file.path !== path) }));
  },

  clearInputFiles() {
    set({ inputFiles: [] });
  },

  setReferenceUrl(value) {
    set({ referenceUrl: value });
  },

  async pickDesignSystemDirectory() {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.pickDesignSystemDirectory();
      set({ config: next });
      if (next.designSystem) {
        get().pushToast({
          variant: 'success',
          title: tr('notifications.designSystemLinked'),
          description: next.designSystem.summary,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : tr('errors.generic');
      get().pushToast({
        variant: 'error',
        title: tr('notifications.designSystemScanFailed'),
        description: message,
      });
    }
  },

  async clearDesignSystem() {
    if (!window.codesign) return;
    try {
      const next = await window.codesign.clearDesignSystem();
      set({ config: next });
      get().pushToast({ variant: 'info', title: tr('notifications.designSystemCleared') });
    } catch (err) {
      const message = err instanceof Error ? err.message : tr('errors.generic');
      get().pushToast({
        variant: 'error',
        title: tr('notifications.clearDesignSystemFailed'),
        description: message,
      });
    }
  },

  clearError() {
    set({ errorMessage: null });
  },

  selectCanvasElement(selection) {
    set({ selectedElement: selection });
  },

  clearCanvasElement() {
    set({ selectedElement: null });
  },

  setPreviewZoom(zoom) {
    set({ previewZoom: zoom });
  },

  setInteractionMode(mode) {
    if (mode === 'default') {
      set({ interactionMode: mode, selectedElement: null, commentBubble: null });
    } else {
      set({ interactionMode: mode });
    }
  },

  setTheme(theme) {
    applyThemeClass(theme);
    persistTheme(theme);
    set({ theme });
  },

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  setView(view) {
    const prev = get().view;
    set({ view, previousView: prev === view ? get().previousView : prev });
  },

  openSettingsTab(tab) {
    const prev = get().view;
    set({
      view: 'settings',
      previousView: prev === 'settings' ? get().previousView : prev,
      settingsTab: tab,
    });
  },

  clearSettingsTab() {
    set({ settingsTab: null });
  },

  setHubTab(tab) {
    set({ hubTab: tab });
  },

  setPreviewViewport(viewport) {
    set({ previewViewport: viewport });
  },

  setSidebarCollapsed(collapsed: boolean) {
    set({ sidebarCollapsed: collapsed });
  },

  openCanvasFileTab(path: string) {
    set((s) => {
      const result = openFileTab(s.canvasTabs, path);
      return { canvasTabs: result.tabs, activeCanvasTab: result.index };
    });
  },

  closeCanvasTab(index: number) {
    set((s) => {
      const result = closeTabAt(s.canvasTabs, s.activeCanvasTab, index);
      return { canvasTabs: result.tabs, activeCanvasTab: result.activeIndex };
    });
  },

  setActiveCanvasTab(index: number) {
    set((s) => {
      if (index < 0 || index >= s.canvasTabs.length) return {};
      return { activeCanvasTab: index };
    });
  },

  resetCanvasTabs() {
    set({ canvasTabs: [FILES_TAB], activeCanvasTab: 0 });
  },
}));
