import {
  CodesignError,
  ERROR_CODES,
  type LastDoneStateV1,
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

function validationFailures(state: ResourceStateV1, source: string): string[] {
  const failures: string[] = [];
  if (state.loadedSkills.includes('chart-rendering') && !hasRealChartMarkup(source)) {
    failures.push(
      'Loaded skill chart-rendering, but index.html does not contain real SVG, canvas, or chart-component marks.',
    );
  }
  if (state.loadedSkills.includes('craft-polish') && !hasCraftPolishSignals(source)) {
    failures.push(
      'Loaded skill craft-polish, but index.html is missing basic focus, hover, or non-happy-path state signals.',
    );
  }
  return failures;
}

export function assertFinalizationGate(input: FinalizationGateInput): void {
  if (!input.enforce) return;
  const file = input.fs.view('index.html');
  if (file === null || file.content.trim().length === 0) {
    throw new CodesignError(
      'Generation incomplete: workspace index.html is missing or empty.',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  const done = input.state.lastDone;
  if (done === null) {
    throw new CodesignError(
      'Generation incomplete: the agent edited the workspace but did not call done(status="ok").',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  if (done.status !== 'ok') {
    throw new CodesignError(
      'Generation incomplete: done() reported unresolved errors.',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  if (done.mutationSeq !== input.state.mutationSeq) {
    throw new CodesignError(
      'Generation incomplete: the workspace changed after the last successful done() call.',
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
  const failures = validationFailures(input.state, file.content);
  if (failures.length > 0) {
    throw new CodesignError(
      `Generation incomplete: ${failures.join(' ')}`,
      ERROR_CODES.GENERATION_INCOMPLETE,
    );
  }
}
