import {
  type EditmodeBlock,
  parseEditmodeBlock,
  parseTweakSchema,
  type TweakSchema,
} from './editmode';

export type TweakSourceState =
  | { status: 'missing' | 'empty'; block: EditmodeBlock | null; schema: TweakSchema | null }
  | { status: 'ready'; block: EditmodeBlock; schema: TweakSchema | null }
  | { status: 'invalid'; block: null; schema: null; error: string };

export function inspectTweakSource(source: string): TweakSourceState {
  try {
    const block = parseEditmodeBlock(source);
    const schema = parseTweakSchema(source);
    if (!schema && /\/\*\s*TWEAK-SCHEMA-(?:BEGIN|END)\s*\*\//.test(source)) {
      return {
        status: 'invalid',
        block: null,
        schema: null,
        error: 'TWEAK_SCHEMA requires matching BEGIN and END markers.',
      };
    }
    if (!block) {
      if (/\/\*\s*EDITMODE-(?:BEGIN|END)\s*\*\//.test(source)) {
        return {
          status: 'invalid',
          block: null,
          schema: null,
          error: 'EDITMODE requires matching BEGIN and END markers.',
        };
      }
      return { status: 'missing', block: null, schema };
    }
    for (const [key, value] of Object.entries(block.tokens)) {
      const entry = schema?.[key];
      if (!entry) continue;
      const expectedType =
        entry.kind === 'number' ? 'number' : entry.kind === 'boolean' ? 'boolean' : 'string';
      if (
        typeof value !== expectedType ||
        (entry.kind === 'enum' && !entry.options.includes(String(value))) ||
        (entry.kind === 'number' &&
          typeof value === 'number' &&
          (!Number.isFinite(value) ||
            value < (entry.min ?? 0) ||
            value > (entry.max ?? 100) ||
            (entry.step ?? 1) <= 0))
      ) {
        return {
          status: 'invalid',
          block: null,
          schema: null,
          error: `Tweak "${key}" does not match its declared control type, options, or range.`,
        };
      }
    }
    return {
      status: Object.keys(block.tokens).length > 0 ? 'ready' : 'empty',
      block,
      schema,
    };
  } catch (error) {
    return {
      status: 'invalid',
      block: null,
      schema: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
