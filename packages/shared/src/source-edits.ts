import { z } from 'zod';

// The retired source value remains parseable only to return an explicit migration refusal.
export const SourceEditSelectionMode = z.enum(['preview', 'source']);
export type SourceEditSelectionMode = z.infer<typeof SourceEditSelectionMode>;

export const SourceEditScope = z.literal('source-definition');
export type SourceEditScope = z.infer<typeof SourceEditScope>;

export const SourceEditAttributeName = z.enum([
  'title',
  'placeholder',
  'alt',
  'aria-label',
  'href',
  'src',
]);
export type SourceEditAttributeName = z.infer<typeof SourceEditAttributeName>;

export const SourceEditStyleProperty = z.enum([
  'color',
  'background',
  'backgroundColor',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'padding',
  'margin',
  'gap',
  'width',
  'height',
  'maxWidth',
  'minHeight',
  'border',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'boxShadow',
  'opacity',
  'overflow',
  'display',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'flexWrap',
  'gridTemplateColumns',
  'objectFit',
]);
export type SourceEditStyleProperty = z.infer<typeof SourceEditStyleProperty>;

const ItemIndex = z.number().int().min(0).max(1_000);

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
      kind: z.literal('remove-attribute'),
      name: SourceEditAttributeName,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-style'),
      property: SourceEditStyleProperty,
      value: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remove-style'),
      property: SourceEditStyleProperty,
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-class-name'),
      value: z.string().max(4_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('toggle-visibility'),
      hidden: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('reorder-sibling'),
      direction: z.enum(['up', 'down']),
      itemIndex: ItemIndex.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('duplicate-element'),
      itemIndex: ItemIndex.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete-element'),
      itemIndex: ItemIndex.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set-map-item-text'),
      itemIndex: ItemIndex,
      fieldKey: z.string().min(1).max(128),
      value: z.string().max(100_000),
    })
    .strict(),
]);
export type SourceEditOperation = z.infer<typeof SourceEditOperation>;

export function sourceEditFieldKey(operation: SourceEditOperation): string {
  switch (operation.kind) {
    case 'set-text':
      return `text:${operation.textId ?? 'only'}`;
    case 'set-attribute':
    case 'remove-attribute':
      return `attribute:${operation.name}`;
    case 'set-style':
    case 'remove-style':
      return `style:${operation.property}`;
    case 'set-class-name':
      return 'className';
    case 'toggle-visibility':
      return 'visibility';
    case 'reorder-sibling':
      return operation.itemIndex === undefined
        ? 'structure:reorder'
        : `structure:reorder:${operation.itemIndex}`;
    case 'duplicate-element':
      return operation.itemIndex === undefined
        ? 'structure:duplicate'
        : `structure:duplicate:${operation.itemIndex}`;
    case 'delete-element':
      return operation.itemIndex === undefined
        ? 'structure:delete'
        : `structure:delete:${operation.itemIndex}`;
    case 'set-map-item-text':
      return `map-text:${operation.itemIndex}:${operation.fieldKey}`;
  }
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
    field: z.enum(['target', 'text', 'attributes', 'style', 'structure']),
    reason: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type SourceEditUnsupported = z.infer<typeof SourceEditUnsupported>;

export const SourceEditTargetCapabilities = z
  .object({
    canUpsertStyle: z.boolean(),
    canUpsertAttribute: z.boolean(),
    canEditClassName: z.boolean(),
    canReorderUp: z.boolean(),
    canReorderDown: z.boolean(),
    canDuplicate: z.boolean(),
    canDelete: z.boolean(),
    sharedDefinition: z.boolean(),
    enclosingComponent: z.string().min(1).max(160).optional(),
    styleMode: z.enum(['inline', 'tailwind', 'html']),
  })
  .strict();
export type SourceEditTargetCapabilities = z.infer<typeof SourceEditTargetCapabilities>;

export const SourceEditStyleBinding = z
  .object({
    property: SourceEditStyleProperty,
    expression: z.string().max(1_000),
    tokenName: z.string().min(1).max(160).optional(),
    editable: z.boolean(),
  })
  .strict();
export type SourceEditStyleBinding = z.infer<typeof SourceEditStyleBinding>;

export const SourceEditMapField = z
  .object({
    key: z.string().min(1).max(128),
    property: z.string().min(1).max(128).optional(),
    values: z.array(z.string().max(100_000)),
  })
  .strict();
export type SourceEditMapField = z.infer<typeof SourceEditMapField>;

export const SourceEditMapSource = z
  .object({
    arrayName: z.string().min(1).max(160),
    itemCount: z.number().int().nonnegative(),
    fields: z.array(SourceEditMapField),
  })
  .strict();
export type SourceEditMapSource = z.infer<typeof SourceEditMapSource>;

export const SourceEditMapItemBinding = z
  .object({
    targetId: z.string().regex(/^\d+:\d+$/),
    paramsStart: z.number().int().nonnegative(),
    paramsEnd: z.number().int().nonnegative(),
    wrapParens: z.boolean(),
    existingIndexName: z.string().min(1).max(128).optional(),
    rootInsertionOffset: z.number().int().nonnegative(),
  })
  .strict();
export type SourceEditMapItemBinding = z.infer<typeof SourceEditMapItemBinding>;

export const SourceEditLocation = z
  .object({
    startLine: z.number().int().positive(),
    startCol: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endCol: z.number().int().positive(),
  })
  .strict();
export type SourceEditLocation = z.infer<typeof SourceEditLocation>;

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
    capabilities: SourceEditTargetCapabilities.optional(),
    styleBindings: z.array(SourceEditStyleBinding).optional(),
    className: z.string().max(4_000).optional(),
    mapSource: SourceEditMapSource.optional(),
    sourceLocation: SourceEditLocation.optional(),
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
      mapItemBindings: z.array(SourceEditMapItemBinding).optional(),
      canUndo: z.boolean().optional(),
      canRedo: z.boolean().optional(),
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

/** Upper bound for fields committed together; one inspector selection stays well below it. */
export const SOURCE_EDIT_BATCH_MAX_OPERATIONS = 32;

// Several fields of one selected definition, planned in order and committed as one write.
export const SourceEditApplyBatchRequestV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1),
    path: z.string().min(1),
    expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    previewRevision: z.string().min(1),
    targetId: z.string().regex(/^\d+:\d+$/),
    operations: z.array(SourceEditOperation).min(1).max(SOURCE_EDIT_BATCH_MAX_OPERATIONS),
    scope: SourceEditScope,
  })
  .strict();
export type SourceEditApplyBatchRequestV1 = z.infer<typeof SourceEditApplyBatchRequestV1>;

export const SourceEditHistoryRequestV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1),
    path: z.string().min(1),
    expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    previewRevision: z.string().min(1),
  })
  .strict();
export type SourceEditHistoryRequestV1 = z.infer<typeof SourceEditHistoryRequestV1>;

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
      canUndo: z.boolean().optional(),
      canRedo: z.boolean().optional(),
    })
    .strict(),
  SourceEditRejectedV1,
]);
export type SourceEditApplyResultV1 = z.infer<typeof SourceEditApplyResultV1>;

const FiniteNonNegative = z.number().finite().nonnegative();

export const SourceEditBoxSides = z
  .object({
    top: FiniteNonNegative,
    right: FiniteNonNegative,
    bottom: FiniteNonNegative,
    left: FiniteNonNegative,
  })
  .strict();
export type SourceEditBoxSides = z.infer<typeof SourceEditBoxSides>;

export const SourceEditBoxModel = z
  .object({
    width: FiniteNonNegative,
    height: FiniteNonNegative,
    padding: SourceEditBoxSides,
    margin: SourceEditBoxSides,
    border: SourceEditBoxSides,
  })
  .strict();
export type SourceEditBoxModel = z.infer<typeof SourceEditBoxModel>;

export const SourceEditChildSummary = z
  .object({
    selector: z.string().min(1).max(4_000),
    tagName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z][A-Za-z0-9-]*$/),
    textPreview: z.string().max(120).optional(),
    targetId: z
      .string()
      .regex(/^\d{1,10}:\d{1,10}$/)
      .optional(),
  })
  .strict();
export type SourceEditChildSummary = z.infer<typeof SourceEditChildSummary>;

export const SourceEditElementSnapshot = z
  .object({
    computedStyle: z.partialRecord(SourceEditStyleProperty, z.string().max(1_000)),
    boxModel: SourceEditBoxModel,
    instanceCount: z.number().int().min(1).max(10_000),
    itemIndex: z.number().int().min(0).max(10_000).optional(),
    parentLayout: z
      .object({
        display: z.string().max(64),
        flexDirection: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
    siblingIndex: z.number().int().min(0).max(10_000).optional(),
    siblingCount: z.number().int().min(1).max(10_000).optional(),
    children: z.array(SourceEditChildSummary).max(24).optional(),
    elementMeta: z
      .object({
        className: z.string().max(4_000).optional(),
        id: z.string().max(256).optional(),
        href: z.string().max(2_048).optional(),
        src: z.string().max(2_048).optional(),
        naturalWidth: FiniteNonNegative.optional(),
        naturalHeight: FiniteNonNegative.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SourceEditElementSnapshot = z.infer<typeof SourceEditElementSnapshot>;

export interface SourceEditPreviewDraft {
  styles: Partial<Record<string, string>>;
  removedStyles?: string[];
  attributes: Partial<Record<string, string>>;
  texts?: Record<string, string>;
  className?: string;
  hidden?: boolean;
}

export interface SourceEditAstHandoffContext {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  sourceExcerpt: string;
  enclosingComponent?: string;
  mapContext?: string;
  unsupportedReasons?: string[];
  textProvenance?: string[];
  computedStyles?: Partial<Record<string, string>>;
}
