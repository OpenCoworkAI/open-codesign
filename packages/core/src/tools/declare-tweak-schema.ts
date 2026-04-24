/**
 * declare_tweak_schema — agent-facing tool that injects (or replaces) a
 * `TWEAK_SCHEMA` block in the artifact, parallel to the existing
 * `TWEAK_DEFAULTS` (EDITMODE) block.
 *
 * Why: TWEAK_DEFAULTS only carries token *values*. The host's TweakPanel has
 * to guess control types from value shape — a number could be a 4–32px
 * padding or a 12–72px font size. By calling `declare_tweak_schema`, the
 * agent declares the intended UI control per token (`number` with min/max,
 * `enum` with options, `boolean`, etc.) so the panel renders precise
 * controls instead of a generic numeric input.
 *
 * Output format embedded in the file (mirrors EDITMODE):
 *
 *   const TWEAK_SCHEMA = /\* TWEAK-SCHEMA-BEGIN *\/{
 *     "accentColor": { "kind": "color" },
 *     "radius": { "kind": "number", "min": 0, "max": 32, "step": 2, "unit": "px" }
 *   }/\* TWEAK-SCHEMA-END *\/;
 *
 * The block is *advisory*: TweakPanel falls back to its existing heuristic
 * for any token missing from the schema. So this tool is safe to call after
 * a partial design is in place.
 *
 * Implementation notes:
 *   - We read the current file via fs.view, compute the new content via
 *     `replaceTweakSchema`, then write back through fs.strReplace (or fall
 *     back to fs.create if no anchor exists yet).
 *   - We do NOT touch the EDITMODE block. That stays the agent's
 *     responsibility through str_replace_based_edit_tool.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { parseTweakSchema, replaceTweakSchema, type TweakSchema } from '@open-codesign/shared';
import { Type } from '@sinclair/typebox';
import type { TextEditorFsCallbacks } from './text-editor.js';

const SchemaEntry = Type.Object({
  kind: Type.Union([
    Type.Literal('color'),
    Type.Literal('number'),
    Type.Literal('enum'),
    Type.Literal('boolean'),
    Type.Literal('string'),
  ]),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  step: Type.Optional(Type.Number()),
  unit: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String())),
  placeholder: Type.Optional(Type.String()),
});

const DeclareTweakSchemaParams = Type.Object({
  path: Type.Optional(Type.String()),
  schema: Type.Record(Type.String(), SchemaEntry),
});

export interface DeclareTweakSchemaError {
  message: string;
  source?: string;
}

export interface DeclareTweakSchemaDetails {
  status: 'ok' | 'error';
  path: string;
  schema: TweakSchema;
  errors: DeclareTweakSchemaError[];
}

export function makeDeclareTweakSchemaTool(
  fs: TextEditorFsCallbacks,
): AgentTool<typeof DeclareTweakSchemaParams, DeclareTweakSchemaDetails> {
  return {
    name: 'declare_tweak_schema',
    label: 'Declare tweak schema',
    description:
      'Declare UI control hints for tokens already present in TWEAK_DEFAULTS. ' +
      'Each entry picks a control: { kind: "color" } | { kind: "number", min, max, step, unit } | ' +
      '{ kind: "enum", options: [...] } | { kind: "boolean" } | { kind: "string", placeholder }. ' +
      'Call AFTER writing TWEAK_DEFAULTS. The host injects/replaces a TWEAK_SCHEMA ' +
      'block right after TWEAK_DEFAULTS in `index.html`. Calling again replaces ' +
      'the previous schema. Tokens left out fall back to host heuristics.',
    parameters: DeclareTweakSchemaParams,
    async execute(_id, params): Promise<AgentToolResult<DeclareTweakSchemaDetails>> {
      const path = params.path ?? 'index.html';
      const errors: DeclareTweakSchemaError[] = [];

      // Re-validate via the shared parser by round-tripping the input through
      // a synthetic block. This filters out unknown kinds / malformed enums
      // so we never write garbage into the artifact.
      const synthetic = `/*TWEAK-SCHEMA-BEGIN*/${JSON.stringify(params.schema)}/*TWEAK-SCHEMA-END*/`;
      const validated = parseTweakSchema(synthetic) ?? {};
      for (const key of Object.keys(params.schema)) {
        if (!(key in validated)) {
          errors.push({
            message: `Token "${key}" rejected (invalid kind or missing required fields)`,
            source: 'schema',
          });
        }
      }

      const file = fs.view(path);
      if (file === null) {
        const details: DeclareTweakSchemaDetails = {
          status: 'error',
          path,
          schema: validated,
          errors: [{ message: `File not found: ${path}`, source: 'fs' }, ...errors],
        };
        return {
          content: [{ type: 'text', text: `error — file not found: ${path}` }],
          details,
        };
      }

      const next = replaceTweakSchema(file.content, validated);
      if (next === file.content) {
        const details: DeclareTweakSchemaDetails = {
          status: 'error',
          path,
          schema: validated,
          errors: [
            {
              message:
                'No anchor found: artifact must declare TWEAK_DEFAULTS (marked or bare) before declare_tweak_schema can inject a schema block.',
              source: 'schema',
            },
            ...errors,
          ],
        };
        return {
          content: [
            {
              type: 'text',
              text: 'error — no TWEAK_DEFAULTS in artifact yet; write it via str_replace_based_edit_tool first.',
            },
          ],
          details,
        };
      }

      // Apply via str_replace using the full file body as the unique anchor.
      // This avoids needing the host to expose a "writeFile" callback.
      try {
        fs.strReplace(path, file.content, next);
      } catch (err) {
        const details: DeclareTweakSchemaDetails = {
          status: 'error',
          path,
          schema: validated,
          errors: [
            { message: err instanceof Error ? err.message : String(err), source: 'fs' },
            ...errors,
          ],
        };
        return {
          content: [
            { type: 'text', text: `error — failed to write schema: ${details.errors[0]?.message}` },
          ],
          details,
        };
      }

      const status: DeclareTweakSchemaDetails['status'] = errors.length === 0 ? 'ok' : 'error';
      const details: DeclareTweakSchemaDetails = { status, path, schema: validated, errors };
      const summary = `${status} — wrote schema for ${Object.keys(validated).length} token(s) to ${path}`;
      const text =
        errors.length === 0
          ? summary
          : `${summary}\n${errors.map((e) => `- ${e.message}`).join('\n')}`;
      return { content: [{ type: 'text', text }], details };
    },
  };
}
