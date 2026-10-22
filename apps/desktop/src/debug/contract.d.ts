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
  /** Large single-poll cursor deltas; diagnostic only, not a pass/fail gate. */
  cursorJumpSamples?: number;
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

export interface UiDebugSession {
  signal: AbortSignal;
  snapshot(): Promise<UiDebugFrame>;
  act(steps: PreviewStep[]): Promise<UiDebugFrame>;
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
