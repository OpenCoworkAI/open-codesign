import {
  CodesignError,
  DEFAULT_SOURCE_ENTRY,
  ERROR_CODES,
  type LastDoneStateV1,
  LEGACY_SOURCE_ENTRY,
  normalizeResourceState,
  type ResourceStateV1,
} from '@open-codesign/shared';
import type { TextEditorFsCallbacks } from './tools/text-editor.js';

export function cloneResourceState(input: ResourceStateV1 | undefined): ResourceStateV1 {
  return normalizeResourceState(input);
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

export function recordLoadedResource(state: ResourceStateV1, name: string): void {
  if (name.startsWith('brand:')) addUnique(state.loadedBrandRefs, name);
  else addUnique(state.loadedSkills, name);
}

export function recordMutation(state: ResourceStateV1): number {
  state.mutationSeq += 1;
  state.lastDone = null;
  return state.mutationSeq;
}

export function recordScaffold(
  state: ResourceStateV1,
  input: { kind: string; destPath: string; bytes: number },
): void {
  state.scaffoldedFiles.push(input);
  recordMutation(state);
}

export function recordDone(
  state: ResourceStateV1,
  input: Omit<LastDoneStateV1, 'mutationSeq' | 'checkedAt'>,
): void {
  state.lastDone = {
    ...input,
    mutationSeq: state.mutationSeq,
    checkedAt: new Date().toISOString(),
  };
}

export interface FinalizationGateInput {
  state: ResourceStateV1;
  fs: TextEditorFsCallbacks;
  enforce: boolean;
  allowUnresolvedDoneWithArtifact?: boolean | undefined;
}

function hasRealChartMarkup(source: string): boolean {
  return (
    /<svg\b[\s\S]*<(?:path|rect|circle|line|polyline|polygon|text)\b/i.test(source) ||
    /<canvas\b/i.test(source) ||
    /\b(?:LineChart|BarChart|AreaChart|PieChart|ResponsiveContainer|Chart)\b/.test(source)
  );
}

function hasCraftPolishSignals(source: string): boolean {
  const hasFocus = /:focus(?:-visible)?|\bonFocus\b|focus-visible/i.test(source);
  const hasHover = /:hover|\bonMouseEnter\b|\bonPointerEnter\b/i.test(source);
  const hasState =
    /\bempty\b|no data|zero state|loading|skeleton|error state|toast|modal|drawer|tab/i.test(
      source,
    );
  return hasFocus && hasHover && hasState;
}

function validationFailures(state: ResourceStateV1, source: string, path: string): string[] {
  const failures: string[] = [];
  if (state.loadedSkills.includes('chart-rendering') && !hasRealChartMarkup(source)) {
    failures.push(
      `Loaded skill chart-rendering, but ${path} does not contain real SVG, canvas, or chart-component marks.`,
    );
  }
  if (state.loadedSkills.includes('craft-polish') && !hasCraftPolishSignals(source)) {
    failures.push(
      `Loaded skill craft-polish, but ${path} is missing basic focus, hover, or non-happy-path state signals.`,
    );
  }
  return failures;
}

function readMainSource(fs: TextEditorFsCallbacks): { path: string; content: string } | null {
  const primary = fs.view(DEFAULT_SOURCE_ENTRY);
  if (primary !== null && primary.content.trim().length > 0) {
    return { path: DEFAULT_SOURCE_ENTRY, content: primary.content };
  }
  const legacy = fs.view(LEGACY_SOURCE_ENTRY);
  if (legacy !== null && legacy.content.trim().length > 0) {
    return { path: LEGACY_SOURCE_ENTRY, content: legacy.content };
  }
  return null;
}

function readNonEmptyFile(
  fs: TextEditorFsCallbacks,
  path: string | undefined,
): { path: string; content: string } | null {
  if (path === undefined || path.trim().length === 0) return null;
  const file = fs.view(path);
  if (file === null || file.content.trim().length === 0) return null;
  return { path, content: file.content };
}

function isRenderableFinalSourcePath(path: string): boolean {
  return /\.(?:jsx|tsx|html?)$/i.test(path);
}

export function assertFinalizationGate(input: FinalizationGateInput): string[] {
  if (!input.enforce) return [];
  const done = input.state.lastDone;
  const file = readMainSource(input.fs) ?? readNonEmptyFile(input.fs, done?.path);
  if (file === null) {
    throw new CodesignError(
      `Generation incomplete: workspace ${DEFAULT_SOURCE_ENTRY} is missing or empty and no done() target file is available.`,
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  if (done === null) {
    if (input.allowUnresolvedDoneWithArtifact) {
      return [
        'The agent edited the workspace but did not call done(status="ok"); keeping the generated artifact available.',
      ];
    }
    throw new CodesignError(
      'Generation incomplete: the agent edited the workspace but did not call done(status="ok").',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  if (done.status !== 'ok') {
    if (input.allowUnresolvedDoneWithArtifact) {
      return ['done() reported unresolved errors; keeping the generated artifact available.'];
    }
    throw new CodesignError(
      'Generation incomplete: done() reported unresolved errors.',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  if (done.mutationSeq !== input.state.mutationSeq) {
    if (input.allowUnresolvedDoneWithArtifact) {
      return [
        'The workspace changed after the last successful done() call; keeping the latest artifact available.',
      ];
    }
    throw new CodesignError(
      'Generation incomplete: the workspace changed after the last successful done() call.',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  const failures = isRenderableFinalSourcePath(file.path)
    ? validationFailures(input.state, file.content, file.path)
    : [];
  if (failures.length > 0) {
    return failures;
  }
  return [];
}
