import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ImageContent, TextContent } from '@mariozechner/pi-ai';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * `preview` tool (T3.4). Renders a workspace artifact and returns a
 * structured report. Splitting the preview pipeline out of `done` so
 * the agent can self-check intermediate states without ending the turn.
 *
 * Capability-driven output (T3.6 dispatches based on session model):
 *   - vision-capable model -> includes screenshot (data URL or path).
 *   - text-only model -> returns DOM outline + metrics + console errors.
 *
 * Execution lives in the host's isolated preview browser; this module owns
 * the wire schema + budget caps (asset errors ≤20, console ≤50).
 */

const Selector = Type.String({ minLength: 1, maxLength: 256 });
const BoundedText = Type.String({ maxLength: 2000 });
export const MAX_PREVIEW_STEPS = 16;
const STEP_BUDGET_GUIDANCE =
  `HARD LIMIT: ${MAX_PREVIEW_STEPS} steps per call, counting every action AND assertion. ` +
  'Count before calling. Check one short journey from the initial screen, including setup and outcome assertions. ' +
  'For a longer product, use independent short journeys; every preview call starts a fresh document. ' +
  'Repeat required setup in each call; never send only the remaining tail expecting prior navigation or state. ' +
  'If steps exceed the limit, the entire call is rejected before rendering or running any steps. ' +
  `Correct the arguments and retry with at most ${MAX_PREVIEW_STEPS} steps; this validation error is recoverable. ` +
  'Combine compatible visible/text/value assertions for the same selector in one assert step. ' +
  'Keep critical outcome/shared-state assertions; do not blindly truncate a journey or remove checks to fit. ' +
  'Report any untested remainder instead of claiming complete interaction coverage.';
export const PreviewStep = Type.Union([
  Type.Object(
    { action: Type.Literal('click'), selector: Selector },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('fill'), selector: Selector, value: BoundedText },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('select'), selector: Selector, value: BoundedText },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('press'),
      selector: Selector,
      key: Type.Union([Type.Literal('Enter'), Type.Literal('Escape'), Type.Literal('Tab')]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('assert'),
      selector: Selector,
      visible: Type.Optional(Type.Boolean()),
      text: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
      value: Type.Optional(BoundedText),
    },
    {
      additionalProperties: false,
      anyOf: [{ required: ['visible'] }, { required: ['text'] }, { required: ['value'] }],
    },
  ),
]);
export type PreviewStep = Static<typeof PreviewStep>;

export const PreviewInput = Type.Object({
  path: Type.String({ description: 'Workspace-relative artifact path.' }),
  vision: Type.Optional(Type.Boolean()),
  viewport: Type.Optional(
    Type.Object(
      {
        width: Type.Integer({ minimum: 240, maximum: 2560 }),
        height: Type.Integer({ minimum: 240, maximum: 1600 }),
      },
      { additionalProperties: false },
    ),
  ),
  steps: Type.Optional(
    Type.Array(PreviewStep, {
      maxItems: MAX_PREVIEW_STEPS,
      description: STEP_BUDGET_GUIDANCE,
    }),
  ),
});
export type PreviewInput = Static<typeof PreviewInput>;

export function validatePreviewInput(input: unknown): void {
  if (!Value.Check(PreviewInput, input)) {
    const error = Value.Errors(PreviewInput, input).First();
    throw new Error(`Invalid preview input${error ? ` at ${error.path}: ${error.message}` : ''}`);
  }
  for (const [index, step] of (input.steps ?? []).entries()) {
    if (
      step.action === 'assert' &&
      step.visible === undefined &&
      step.text === undefined &&
      step.value === undefined
    ) {
      throw new Error(
        `Invalid preview input at /steps/${index}: assert requires visible, text, or value`,
      );
    }
  }
}

export const ConsoleEntry = Type.Object({
  level: Type.Union([
    Type.Literal('log'),
    Type.Literal('warn'),
    Type.Literal('error'),
    Type.Literal('info'),
  ]),
  message: Type.String(),
});

export const AssetError = Type.Object({
  url: Type.String(),
  status: Type.Number(),
  type: Type.Optional(Type.String()),
});

export const PreviewResult = Type.Object({
  ok: Type.Boolean(),
  /** Set only when capabilities.vision === true. */
  screenshot: Type.Optional(Type.String()),
  /** Tag tree at depth ≤4 — for text-only models. */
  domOutline: Type.Optional(Type.String()),
  consoleErrors: Type.Array(ConsoleEntry, { maxItems: 50 }),
  assetErrors: Type.Array(AssetError, { maxItems: 20 }),
  metrics: Type.Object({
    nodes: Type.Number(),
    height: Type.Number(),
    width: Type.Number(),
    loadMs: Type.Number(),
  }),
  reason: Type.Optional(Type.String()),
  warnings: Type.Optional(Type.Array(Type.String(), { maxItems: 5 })),
  visibleText: Type.Optional(Type.String()),
  steps: Type.Optional(
    Type.Array(
      Type.Object({
        index: Type.Integer(),
        action: Type.String(),
        selector: Type.String(),
        ok: Type.Boolean(),
        reason: Type.Optional(Type.String()),
      }),
      { maxItems: MAX_PREVIEW_STEPS },
    ),
  ),
});
export type PreviewResult = Static<typeof PreviewResult>;

export const MAX_CONSOLE_ENTRIES = 50;
export const MAX_ASSET_ERRORS = 20;

export function trimPreviewResult(result: PreviewResult): PreviewResult {
  return {
    ...result,
    consoleErrors: result.consoleErrors.slice(0, MAX_CONSOLE_ENTRIES),
    assetErrors: result.assetErrors.slice(0, MAX_ASSET_ERRORS),
  };
}

function previewContent(summary: string, result: PreviewResult): Array<TextContent | ImageContent> {
  const content: Array<TextContent | ImageContent> = [{ type: 'text', text: summary }];
  if (
    result.warnings !== undefined ||
    result.steps !== undefined ||
    result.domOutline !== undefined ||
    result.visibleText !== undefined
  ) {
    content.push({
      type: 'text',
      text: JSON.stringify({
        steps: result.steps,
        warnings: result.warnings,
        visibleText: result.visibleText,
        domOutline: result.domOutline,
        metrics: result.metrics,
        consoleErrors: result.consoleErrors,
        assetErrors: result.assetErrors,
      }),
    });
  }
  if (typeof result.screenshot === 'string' && result.screenshot.startsWith('data:image/')) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(result.screenshot.trim());
    const mimeType = match?.[1];
    const data = match?.[2];
    if (mimeType !== undefined && data !== undefined) {
      content.push({ type: 'image', mimeType, data });
    }
  }
  return content;
}

/** Host-injected preview executor. Loads the artifact at `path` and returns
 *  a structured runtime report. Kept distinct from `DoneRuntimeVerifier` so
 *  preview's wire shape can evolve independently from done's lint + console
 *  error contract. */
export type RunPreviewOptions = Omit<PreviewInput, 'vision'> & {
  vision: boolean;
  signal?: AbortSignal;
};
export type RunPreviewFn = (opts: RunPreviewOptions) => Promise<PreviewResult>;

export function makePreviewTool(
  runPreview: RunPreviewFn,
  opts: { vision?: boolean } = {},
): AgentTool<typeof PreviewInput, PreviewResult> {
  const defaultVision = opts.vision ?? false;
  return {
    name: 'preview',
    label: 'Preview — render and inspect',
    description:
      'Render the artifact at `path` and return the runtime report: ' +
      'console errors (≤50), failing asset requests (≤20), DOM outline ' +
      '(nodes/width/height/load ms), and — on vision-capable models — a ' +
      'screenshot data URL. Call BEFORE `done` to self-check. ' +
      `Optionally set viewport and up to ${MAX_PREVIEW_STEPS} declarative steps (click/fill/select/press/assert). ` +
      `${STEP_BUDGET_GUIDANCE} ` +
      'Use unique CSS selectors (max 256 chars); fill/value max 2000 chars. ' +
      'select chooses one enabled option by its exact value in a native single-selection <select>; ' +
      'disabled controls/options and multiple selects are rejected. ' +
      'press supports Enter/Escape/Tab. assert requires visible, text (contains), or value (exact); ' +
      'visible:false accepts hidden/absent elements. Steps run in order, stop on first failure, ' +
      'and return evidence plus the final screen, not proof of untested product behavior. ' +
      'Each step has 2 seconds, all steps 20 seconds. No state persists between calls. ' +
      'Budget-bounded; safe to call repeatedly.',
    parameters: PreviewInput,
    async execute(_toolCallId, params, signal): Promise<AgentToolResult<PreviewResult>> {
      const vision = params.vision ?? defaultVision;
      try {
        validatePreviewInput(params);
        const raw = await runPreview({ ...params, vision, ...(signal ? { signal } : {}) });
        const result = trimPreviewResult(raw);
        const summary = result.ok
          ? `preview ok: ${result.metrics.nodes} nodes, ${result.consoleErrors.length} console errors, ${result.assetErrors.length} asset errors`
          : `preview failed${result.reason ? `: ${result.reason}` : ''} (${result.consoleErrors.length} console errors, ${result.assetErrors.length} asset errors)`;
        return {
          content: previewContent(summary, result),
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CodesignError(
          `Preview executor failed: ${message}`,
          ERROR_CODES.TOOL_EXECUTION_FAILED,
          {
            cause: err,
          },
        );
      }
    },
  };
}
