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

export interface UiDebugHost {
  loadUiSteps(path?: string): Promise<PreviewStep[]>;
  runUiDebug(options: {
    output: string;
    steps: PreviewStep[];
    signal: AbortSignal;
    defaultJourney: boolean;
  }): Promise<UiDebugReport>;
}
