import type { PreviewResult, PreviewStep } from '@open-codesign/core';

export interface DebugModelOptions {
  mode: 'fixture' | 'live';
  config?: string;
  provider?: string;
  model?: string;
  credentialState?: string;
  codexAuth?: string;
}

export interface DebugModelEvidence {
  mode: 'fixture' | 'live';
  calls: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  maxCalls: number;
  maxOutputTokens: number;
  events: { call: number; status: string; historyMessages: number; tools: boolean }[];
}

export interface WindowsObservation {
  platform: string;
  available: boolean;
  completed?: boolean;
  samples?: number;
  overflow?: boolean;
  visibleWindowEvents?: number;
  foregroundEvents?: number;
  visibleSamples?: number;
  focusSamples?: number;
  injectedMouse?: number;
  injectedKeyboard?: number;
  cursorUnchanged?: boolean;
  foregroundUnchanged?: boolean;
}

export interface UiDebugReport {
  schemaVersion: 1;
  ok: boolean;
  host: 'electron-offscreen';
  screenshots: string[];
  steps: NonNullable<PreviewResult['steps']>;
  errors: { source: string; message: string }[];
  errorsTruncated: boolean;
  windows: WindowsObservation;
  persistedDesigns: number;
  workspacesContained: boolean;
  cleanup: boolean;
  model?: DebugModelEvidence;
  artifacts?: { path: string; bytes: number; sha256: string }[];
  runs?: { generationId: string; status: string }[];
  operations?: DebugOperationSummary;
}

export interface UiDebugElement {
  selector: string;
  tag: string;
  role: string;
  label: string;
  text: string;
  value?: string;
  disabled: boolean;
}

export interface UiDebugFrame {
  screenshot: string;
  elements: UiDebugElement[];
  elementsTruncated: boolean;
  steps: UiDebugReport['steps'];
  errors: UiDebugReport['errors'];
  errorCount: number;
  errorsTruncated: boolean;
  windows: WindowsObservation;
  model?: DebugModelEvidence;
  runs?: UiDebugReport['runs'];
}

export interface DebugOperationCapability {
  name: string;
  channel: string;
  kind: 'call' | 'event';
  domain: string;
  mode: 'local' | 'model' | 'live' | 'unsupported';
  available: boolean;
  reason?: string;
  parameters: { name: string; type: string; required: boolean; definition?: string }[];
}

export interface DebugOperationTask {
  taskId: string;
  operation: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: { code: string; message: string };
  cancellationRequested?: boolean;
}

export interface DebugOperationEvent {
  cursor: number;
  type: string;
  operation: string;
  at: string;
  data?: unknown;
}

export interface DebugOperationEventPage {
  after: number;
  cursor: number;
  dropped: number;
  events: DebugOperationEvent[];
}

export interface DebugOperationSummary {
  calls: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  eventsDropped: number;
}

export interface UiDebugSession {
  signal: AbortSignal;
  snapshot(): Promise<UiDebugFrame>;
  act(steps: PreviewStep[]): Promise<UiDebugFrame>;
  capabilities?(): DebugOperationCapability[];
  call?(operation: string, args: unknown[]): DebugOperationTask;
  task?(taskId: string): DebugOperationTask;
  cancel?(taskId: string): Promise<DebugOperationTask>;
  events?(after: number, limit?: number): DebugOperationEventPage;
}

export interface UiDebugHost {
  validateUiSteps(input: unknown): PreviewStep[];
  loadUiSteps(path?: string): Promise<PreviewStep[]>;
  runUiDebug(options: {
    output: string;
    steps: PreviewStep[];
    signal: AbortSignal;
    defaultJourney: boolean;
    interact?: (session: UiDebugSession) => Promise<void>;
    model?: DebugModelOptions;
  }): Promise<UiDebugReport>;
}
