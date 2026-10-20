import { z } from 'zod';

export const DesignTokenV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  type: z.enum([
    'color',
    'fontFamily',
    'fontSize',
    'spacing',
    'radius',
    'shadow',
    'lineHeight',
    'unknown',
  ]),
  name: z.string().min(1),
  value: z.string().min(1),
  origin: z.enum(['tailwind-config', 'css-vars', 'figma', 'manual', 'pdf', 'dtcg-json']),
  group: z.string().optional(),
  /**
   * Selector of the block a CSS variable was declared in, set only when it is not the
   * default `:root` or `@theme` block, so a theme variant never looks like the default.
   */
  block: z.string().optional(),
});
export type DesignToken = z.infer<typeof DesignTokenV1>;

export const DesignTokenSet = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().min(1),
  source: z.string().optional(),
  tokens: z.array(DesignTokenV1),
});
export type DesignTokenSet = z.infer<typeof DesignTokenSet>;
