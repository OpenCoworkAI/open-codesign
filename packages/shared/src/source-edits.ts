import { z } from 'zod';

// The retired source value remains parseable only to return an explicit migration refusal.
export const SourceEditSelectionMode = z.enum(['preview', 'source']);
export type SourceEditSelectionMode = z.infer<typeof SourceEditSelectionMode>;

export const SourceEditScope = z.literal('source-definition');
export type SourceEditScope = z.infer<typeof SourceEditScope>;
export const SourceEditAttributeName = z.enum(['title', 'placeholder', 'alt']);
export type SourceEditAttributeName = z.infer<typeof SourceEditAttributeName>;
export const SourceEditStyleProperty = z.enum([
  'color',
  'backgroundColor',
  'fontSize',
  'gap',
  'padding',
  'borderRadius',
  'maxWidth',
]);
export type SourceEditStyleProperty = z.infer<typeof SourceEditStyleProperty>;

export const SourceEditOperation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('set-text'),
      value: z.string().max(100_000),
      // Identifies one direct text segment, not a rendered instance or a client-supplied write range.
      textId: z
        .string()
        .regex(/^\d+:\d+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-attribute'),
      name: SourceEditAttributeName,
      value: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-style'),
      property: SourceEditStyleProperty,
      value: z.string().max(1_000),
    })
    .strict(),
]);
export type SourceEditOperation = z.infer<typeof SourceEditOperation>;

export function sourceEditFieldKey(operation: SourceEditOperation): string {
  if (operation.kind === 'set-text') return `text:${operation.textId ?? 'only'}`;
  if (operation.kind === 'set-attribute') return `attribute:${operation.name}`;
  return `style:${operation.property}`;
}

export const SourceEditTextLayout = z
  .array(
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('text'),
          textId: z
            .string()
            .regex(/^\d+:\d+$/)
            .optional(),
          value: z.string().max(100_000),
        })
        .strict(),
      z.object({ kind: z.literal('element'), targetId: z.string().regex(/^\d+:\d+$/) }).strict(),
      z.object({ kind: z.literal('dynamic') }).strict(),
    ]),
  )
  .max(10_000);
export type SourceEditTextLayout = z.infer<typeof SourceEditTextLayout>;

export const SourceEditUnsupported = z
  .object({
    field: z.enum(['target', 'text', 'attributes', 'style']),
    reason: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type SourceEditUnsupported = z.infer<typeof SourceEditUnsupported>;

// These identify source definitions, never a promise of a single rendered instance.
export const SourceEditTarget = z
  .object({
    id: z.string().regex(/^\d+:\d+$/),
    tagName: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    insertionOffset: z.number().int().nonnegative(),
    scope: SourceEditScope,
    editableFields: z.array(SourceEditOperation),
    // Legacy aggregate text is informational; current previews bind fields independently.
    directText: z.string().optional(),
    textLayout: SourceEditTextLayout.optional(),
    textSources: z
      .array(
        z
          .object({
            textId: z
              .string()
              .regex(/^\d+:\d+$/)
              .optional(),
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
            origin: z.string(),
          })
          .strict(),
      )
      .optional(),
    unsupported: z.array(SourceEditUnsupported),
  })
  .strict();
export type SourceEditTarget = z.infer<typeof SourceEditTarget>;

export const SourceEditRejectedV1 = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal('rejected'),
    reason: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type SourceEditRejectedV1 = z.infer<typeof SourceEditRejectedV1>;

export const SourceEditInspectRequestV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1),
    path: z.string().min(1),
    expectedContent: z.string(),
    selectionMode: SourceEditSelectionMode.optional(),
  })
  .strict();
export type SourceEditInspectRequestV1 = z.infer<typeof SourceEditInspectRequestV1>;

export const SourceEditInspectResultV1 = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal('ready'),
      path: z.string().min(1),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      targets: z.array(SourceEditTarget),
    })
    .strict(),
  SourceEditRejectedV1,
]);
export type SourceEditInspectResultV1 = z.infer<typeof SourceEditInspectResultV1>;

export const SourceEditApplyRequestV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1),
    path: z.string().min(1),
    expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    selectionMode: SourceEditSelectionMode.optional(),
    previewRevision: z.string().min(1),
    targetId: z.string().regex(/^\d+:\d+$/),
    operation: SourceEditOperation,
    scope: SourceEditScope,
  })
  .strict();
export type SourceEditApplyRequestV1 = z.infer<typeof SourceEditApplyRequestV1>;

export const SourceEditPatch = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    expectedText: z.string(),
    replacement: z.string(),
  })
  .strict();
export type SourceEditPatch = z.infer<typeof SourceEditPatch>;

export const SourceEditApplyResultV1 = z.discriminatedUnion('status', [
  z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal('applied'),
      path: z.string().min(1),
      content: z.string(),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
      patch: SourceEditPatch,
      scope: SourceEditScope,
      // Main adds ACK metadata after commit; the pure engine need not provide it.
      previewRevision: z.string().min(1).optional(),
      warnings: z.array(z.string()).optional(),
    })
    .strict(),
  SourceEditRejectedV1,
]);
export type SourceEditApplyResultV1 = z.infer<typeof SourceEditApplyResultV1>;
