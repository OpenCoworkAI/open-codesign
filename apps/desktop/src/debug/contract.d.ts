import type { PreviewResult, PreviewStep } from '@open-codesign/core';

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
  }): Promise<UiDebugReport>;
}
