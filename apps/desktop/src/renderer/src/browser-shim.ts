/**
 * Browser-mode shim for window.codesign.
 *
 * When running the renderer outside Electron (e.g. via the standalone Vite
 * config at vite.browser.config.ts), the preload script never executes and
 * window.codesign is undefined. Every store slice guards with
 * `if (!window.codesign) return;` — which means the entire app is inert.
 *
 * This module provides a minimal in-memory implementation of the CodesignApi
 * surface so the hub, settings, workspace, and design editor UI all render
 * and function. Generation itself won't produce real artifacts (no LLM call),
 * but the full UI navigation + design CRUD + chat + snapshots work.
 *
 * Inject by calling `installBrowserShim()` before React mounts.
 */

let designCounter = 0;
let snapshotCounter = 0;
let chatSeqCounter = 0;

interface Design {
  id: string;
  name: string;
  workspacePath: string | null;
  thumbnailText: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  previewMode: string;
  previewUrl: string | null;
}

interface DesignSnapshot {
  id: string;
  designId: string;
  artifactSource: string;
  artifactType: string;
  createdAt: string;
  prompt: string | null;
  message: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

interface ChatMessageRow {
  seq: number;
  designId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface CommentRow {
  id: string;
  designId: string;
  snapshotId: string | null;
  kind: string;
  status: string;
  text: string;
  rect: unknown;
  scope: unknown;
  createdAt: string;
  appliedAt: string | null;
}

const designs: Design[] = [];
const snapshots: Map<string, DesignSnapshot[]> = new Map();
const chats: Map<string, ChatMessageRow[]> = new Map();
const comments: Map<string, CommentRow[]> = new Map();
const files: Map<string, Map<string, string>> = new Map();

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function iso(): string {
  return new Date().toISOString();
}

function persist(): void {
  try {
    localStorage.setItem('__codesign_browser_designs', JSON.stringify(designs));
  } catch {
    // localStorage full or unavailable — silently degrade
  }
}

function restore(): void {
  try {
    const raw = localStorage.getItem('__codesign_browser_designs');
    if (raw) {
      const parsed = JSON.parse(raw) as Design[];
      designs.length = 0;
      designs.push(...parsed);
      designCounter = designs.length;
    }
  } catch {
    // corrupt data — start fresh
  }
}

const noop = () => {};

const shim = {
  detectProvider: async () => null,
  doneVerify: async () => ({ errors: [] }),

  generate: async (payload: {
    prompt: string;
    designId: string;
    generationId: string;
    previousSource?: string;
    [key: string]: unknown;
  }) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #111; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { max-width: 480px; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; line-height: 1.6; }
    .prompt { margin-top: 1rem; padding: 1rem; background: #f0f0f0; border-radius: 8px; font-size: 0.875rem; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Browser Mode Preview</h1>
    <p>Generation requires the Electron main process. Connect a real API provider in the Electron app to see AI-generated designs.</p>
    <div class="prompt">${payload.prompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>
</body>
</html>`;
    return {
      artifacts: [{ type: 'html', content: html, entryPath: 'App.jsx' }],
      message: 'Browser mode — generation simulated.',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  },

  cancelGeneration: async () => {},
  generationStatus: async () => ({ running: [] }),
  generateTitle: async (prompt: string) => {
    const words = prompt.split(/\s+/).slice(0, 5).join(' ');
    return words.length > 30 ? `${words.slice(0, 30)}…` : words;
  },
  applyComment: async () => ({
    artifacts: [],
    message: 'Browser mode — comment apply simulated.',
  }),

  pickInputFiles: async () => [],
  pickDesignSystemDirectory: async () => shimOnboardingState(),
  clearDesignSystem: async () => shimOnboardingState(),

  export: async () => ({ ok: false as const, error: 'Export unavailable in browser mode' }),

  locale: {
    getSystem: async () => 'en',
    getCurrent: async () => 'en',
    set: async () => 'en',
  },

  checkForUpdates: async () => null,
  downloadUpdate: async () => {},
  installUpdate: async () => {},
  onUpdateAvailable: () => noop,

  onboarding: {
    getState: async () => shimOnboardingState(),
    validateKey: async () => ({
      ok: true as const,
      modelCount: 1,
    }),
    saveKey: async () => shimOnboardingState(),
    skip: async () => shimOnboardingState(),
  },

  settings: {
    listProviders: async () => [
      {
        id: 'browser-mock',
        name: 'Browser Mode',
        provider: 'anthropic',
        active: true,
        modelPrimary: 'claude-sonnet-4-6',
        hasKey: true,
        builtin: false,
      },
    ],
    addProvider: async () => [
      {
        id: 'browser-mock',
        name: 'Browser Mode',
        provider: 'anthropic',
        active: true,
        modelPrimary: 'claude-sonnet-4-6',
        hasKey: true,
        builtin: false,
      },
    ],
    deleteProvider: async () => [],
    setActiveProvider: async () => shimOnboardingState(),
    getPaths: async () => ({
      userData: '/browser/data',
      appData: '/browser/config',
      storage: '/browser/storage',
      logs: '/browser/logs',
    }),
    chooseStorageFolder: async () => ({
      userData: '/browser/data',
      appData: '/browser/config',
      storage: '/browser/storage',
      logs: '/browser/logs',
    }),
    openFolder: async () => {},
    openTemplatesFolder: async () => {},
    resetOnboarding: async () => {},
    toggleDevtools: async () => {},
    validateKey: async () => ({
      ok: true as const,
      modelCount: 1,
    }),
  },

  config: {
    setProviderAndModels: async () => shimOnboardingState(),
    addProvider: async () => shimOnboardingState(),
    updateProvider: async () => shimOnboardingState(),
    removeProvider: async () => shimOnboardingState(),
    setActiveProviderAndModel: async () => shimOnboardingState(),
    testEndpoint: async () => ({
      ok: true as const,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }),
    listEndpointModels: async () => ({ ok: true as const, models: ['claude-sonnet-4-6'] }),
    detectExternalConfigs: async () => ({
      claudeCode: null,
      codex: null,
      gemini: null,
      opencode: null,
    }),
    importCodexConfig: async () => shimOnboardingState(),
    importClaudeCodeConfig: async () => shimOnboardingState(),
    importGeminiConfig: async () => shimOnboardingState(),
    importOpencodeConfig: async () => shimOnboardingState(),
  },

  preferences: {
    get: async () => ({
      dismissedUpdateVersion: null,
      theme: 'system',
    }),
    update: async (patch: Record<string, unknown>) => ({
      dismissedUpdateVersion: null,
      theme: 'system',
      ...patch,
    }),
  },

  memory: {
    getUser: async () => null,
    updateUser: async () => null,
    openUserMemory: async () => {},
    consolidateUserMemoryNow: async () => ({ consolidated: false }),
    clearUserMemoryCandidates: async () => {},
  },

  imageGeneration: {
    get: async () => ({
      provider: null,
      model: null,
      apiKey: null,
      baseUrl: null,
    }),
    update: async (patch: Record<string, unknown>) => ({
      provider: null,
      model: null,
      apiKey: null,
      baseUrl: null,
      ...patch,
    }),
  },

  codexOAuth: {
    status: async () => ({ loggedIn: false }),
    login: async () => ({ loggedIn: false }),
    cancelLogin: async () => false,
    logout: async () => ({ loggedIn: false }),
  },

  connection: {
    test: async () => ({ ok: true as const, provider: 'anthropic', model: 'claude-sonnet-4-6' }),
    testActive: async () => ({
      ok: true as const,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }),
    testProvider: async () => ({
      ok: true as const,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }),
    testImageProvider: async () => ({ ok: true as const }),
  },

  models: {
    list: async () => ({
      ok: true as const,
      models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
    }),
    listForProvider: async () => ({
      ok: true as const,
      models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }],
    }),
  },

  ollama: {
    probe: async () => ({ ok: false as const, code: 'not_found', message: 'Browser mode' }),
  },

  files: {
    list: async (designId: string) => {
      const store = files.get(designId);
      if (!store) return [];
      return Array.from(store.entries()).map(([path, content]) => ({
        path,
        kind: path.endsWith('.html') ? 'html' : path.endsWith('.css') ? 'css' : 'text',
        size: content.length,
        updatedAt: iso(),
      }));
    },
    listDir: async (_designId: string, _path = '.') => [],
    read: async (designId: string, path: string) => {
      const store = files.get(designId);
      const content = store?.get(path) ?? '';
      return {
        path,
        kind: 'html' as const,
        size: content.length,
        updatedAt: iso(),
        content,
      };
    },
    preview: async () => ({ ok: false, content: null }),
    thumbnail: async () => ({ ok: false, content: null }),
    write: async (designId: string, path: string, content: string) => {
      let store = files.get(designId);
      if (!store) {
        store = new Map();
        files.set(designId, store);
      }
      store.set(path, content);
      return {
        path,
        kind: 'html' as const,
        size: content.length,
        updatedAt: iso(),
        content,
      };
    },
    importToWorkspace: async () => [],
    subscribe: async () => ({ ok: true as const }),
    unsubscribe: async () => ({ ok: true as const }),
    onChanged: () => noop,
  },

  snapshots: {
    listDesigns: async () => [...designs],
    createDesign: async (name: string, _workspacePath?: string | null) => {
      const id = uid();
      const design: Design = {
        id,
        name,
        workspacePath: `/browser/designs/${++designCounter}`,
        thumbnailText: null,
        createdAt: iso(),
        updatedAt: iso(),
        deletedAt: null,
        previewMode: 'managed-file',
        previewUrl: null,
      };
      designs.unshift(design);
      snapshots.set(id, []);
      chats.set(id, []);
      comments.set(id, []);
      files.set(id, new Map());
      persist();
      return design;
    },
    getDesign: async (id: string) => designs.find((d) => d.id === id) ?? null,
    renameDesign: async (id: string, name: string) => {
      const d = designs.find((x) => x.id === id);
      if (d) {
        d.name = name;
        d.updatedAt = iso();
        persist();
      }
      return (
        d ?? {
          id,
          name,
          workspacePath: null,
          thumbnailText: null,
          createdAt: iso(),
          updatedAt: iso(),
          deletedAt: null,
          previewMode: 'managed-file',
          previewUrl: null,
        }
      );
    },
    setThumbnail: async (id: string, thumbnailText: string | null) => {
      const d = designs.find((x) => x.id === id);
      if (d) {
        d.thumbnailText = thumbnailText;
        d.updatedAt = iso();
        persist();
      }
      return (
        d ?? {
          id,
          name: '',
          workspacePath: null,
          thumbnailText,
          createdAt: iso(),
          updatedAt: iso(),
          deletedAt: null,
          previewMode: 'managed-file',
          previewUrl: null,
        }
      );
    },
    softDeleteDesign: async (id: string) => {
      const d = designs.find((x) => x.id === id);
      if (d) {
        d.deletedAt = iso();
        d.updatedAt = iso();
        const idx = designs.indexOf(d);
        if (idx !== -1) designs.splice(idx, 1);
        persist();
      }
      return (
        d ?? {
          id,
          name: '',
          workspacePath: null,
          thumbnailText: null,
          createdAt: iso(),
          updatedAt: iso(),
          deletedAt: iso(),
          previewMode: 'managed-file',
          previewUrl: null,
        }
      );
    },
    duplicateDesign: async (id: string, name: string) => {
      const orig = designs.find((x) => x.id === id);
      const newId = uid();
      const design: Design = {
        id: newId,
        name,
        workspacePath: `/browser/designs/${++designCounter}`,
        thumbnailText: orig?.thumbnailText ?? null,
        createdAt: iso(),
        updatedAt: iso(),
        deletedAt: null,
        previewMode: 'managed-file',
        previewUrl: null,
      };
      designs.unshift(design);
      snapshots.set(newId, [...(snapshots.get(id) ?? [])]);
      chats.set(newId, []);
      comments.set(newId, []);
      persist();
      return design;
    },
    list: async (designId: string) => snapshots.get(designId) ?? [],
    get: async (id: string) => {
      for (const snaps of snapshots.values()) {
        const found = snaps.find((s) => s.id === id);
        if (found) return found;
      }
      return null;
    },
    create: async (input: {
      designId: string;
      artifactSource: string;
      artifactType?: string;
      prompt?: string;
      message?: string;
    }) => {
      const snap: DesignSnapshot = {
        id: `snap-${++snapshotCounter}`,
        designId: input.designId,
        artifactSource: input.artifactSource,
        artifactType: input.artifactType ?? 'html',
        createdAt: iso(),
        prompt: input.prompt ?? null,
        message: input.message ?? null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      };
      const list = snapshots.get(input.designId) ?? [];
      list.unshift(snap);
      snapshots.set(input.designId, list);
      return snap;
    },
    delete: async (id: string) => {
      for (const [designId, snaps] of snapshots.entries()) {
        const idx = snaps.findIndex((s) => s.id === id);
        if (idx !== -1) {
          snaps.splice(idx, 1);
          snapshots.set(designId, snaps);
          break;
        }
      }
    },
    pickWorkspaceFolder: async () => null,
    updateWorkspace: async (designId: string, workspacePath: string) => {
      const d = designs.find((x) => x.id === designId);
      if (d) {
        d.workspacePath = workspacePath;
        d.updatedAt = iso();
        persist();
      }
      return (
        d ?? {
          id: designId,
          name: '',
          workspacePath,
          thumbnailText: null,
          createdAt: iso(),
          updatedAt: iso(),
          deletedAt: null,
          previewMode: 'managed-file',
          previewUrl: null,
        }
      );
    },
    openWorkspaceFolder: async () => {},
    checkWorkspaceFolder: async () => ({ exists: true }),
    updatePreview: async (designId: string, previewMode: string, previewUrl?: string | null) => {
      const d = designs.find((x) => x.id === designId);
      if (d) {
        d.previewMode = previewMode;
        d.previewUrl = previewUrl ?? null;
        d.updatedAt = iso();
        persist();
      }
      return (
        d ?? {
          id: designId,
          name: '',
          workspacePath: null,
          thumbnailText: null,
          createdAt: iso(),
          updatedAt: iso(),
          deletedAt: null,
          previewMode,
          previewUrl: previewUrl ?? null,
        }
      );
    },
    detectPreview: async () => ({ candidates: [], current: null }),
  },

  chat: {
    list: async (designId: string) => chats.get(designId) ?? [],
    append: async (input: { designId: string; kind: string; payload: Record<string, unknown> }) => {
      const row: ChatMessageRow = {
        seq: ++chatSeqCounter,
        designId: input.designId,
        kind: input.kind,
        payload: input.payload,
        createdAt: iso(),
      };
      const list = chats.get(input.designId) ?? [];
      list.push(row);
      chats.set(input.designId, list);
      return row;
    },
    seedFromSnapshots: async () => ({ inserted: 0 }),
    updateToolStatus: async () => ({ ok: true as const }),
    onAgentEvent: () => noop,
  },

  comments: {
    add: async (input: {
      designId: string;
      snapshotId?: string;
      kind?: string;
      text: string;
      rect?: unknown;
      scope?: unknown;
    }) => {
      const row: CommentRow = {
        id: uid(),
        designId: input.designId,
        snapshotId: input.snapshotId ?? null,
        kind: input.kind ?? 'note',
        status: 'pending',
        text: input.text,
        rect: input.rect ?? null,
        scope: input.scope ?? null,
        createdAt: iso(),
        appliedAt: null,
      };
      const list = comments.get(input.designId) ?? [];
      list.push(row);
      comments.set(input.designId, list);
      return row;
    },
    list: async (designId: string) => comments.get(designId) ?? [],
    listPendingEdits: async (designId: string) =>
      (comments.get(designId) ?? []).filter((c) => c.kind === 'edit' && c.status === 'pending'),
    update: async (designId: string, id: string, patch: { text?: string; status?: string }) => {
      const list = comments.get(designId) ?? [];
      const row = list.find((c) => c.id === id);
      if (row) {
        if (patch.text !== undefined) row.text = patch.text;
        if (patch.status !== undefined) row.status = patch.status;
      }
      return row ?? null;
    },
    remove: async (designId: string, id: string) => {
      const list = comments.get(designId) ?? [];
      const idx = list.findIndex((c) => c.id === id);
      if (idx !== -1) list.splice(idx, 1);
      return { removed: idx !== -1 };
    },
    markApplied: async (designId: string, ids: string[], _snapshotId: string) => {
      const list = comments.get(designId) ?? [];
      return list
        .filter((c) => ids.includes(c.id))
        .map((c) => {
          c.status = 'applied';
          c.appliedAt = iso();
          return c;
        });
    },
  },

  diagnostics: {
    log: async () => {},
    recordRendererError: async () => ({ schemaVersion: 1, eventId: null }),
    openLogFolder: async () => {},
    exportDiagnostics: async () => 'Browser mode — no diagnostics available.',
    showItemInFolder: async () => {},
    listEvents: async () => ({ events: [], total: 0 }),
    reportEvent: async () => ({ ok: true }),
    isFingerprintRecentlyReported: async () => ({ schemaVersion: 1, reported: false }),
  },

  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener');
  },

  ask: {
    pending: async () => [],
    onRequest: () => noop,
    resolve: async () => {},
  },
};

function shimOnboardingState() {
  return {
    schemaVersion: 1,
    hasKey: true,
    provider: 'anthropic',
    modelPrimary: 'claude-sonnet-4-6',
    modelSecondary: null,
    baseUrl: null,
    designSystemPath: null,
    designSystemFileCount: 0,
    providers: {
      'browser-mock': {
        id: 'browser-mock',
        name: 'Browser Mode',
        provider: 'anthropic',
        active: true,
        modelPrimary: 'claude-sonnet-4-6',
        hasKey: true,
        builtin: false,
      },
    },
  };
}

export function installBrowserShim(): void {
  if (window.codesign) return;
  restore();
  (window as unknown as { codesign: typeof shim }).codesign = shim;
}
