type Translate = (key: string, options?: Record<string, unknown>) => string;

// The main process owns reason codes; presentation follows the current UI locale.
export const sourceEditReasonKeys = {
  'unsupported-host': 'unsupportedHost',
  'spread-attributes': 'spreadAttributes',
  'duplicate-attributes': 'duplicateAttributes',
  'reserved-provenance': 'reservedProvenance',
  'children-prop': 'childrenProp',
  'mutable-host': 'mutableHost',
  'unresolved-text-source': 'unresolvedTextSource',
  'non-static-text': 'nonStaticText',
  'dynamic-attribute': 'dynamicAttribute',
  'shared-or-dynamic-style': 'sharedOrDynamicStyle',
  'ambiguous-style': 'ambiguousStyle',
  'dynamic-style-value': 'dynamicStyleValue',
  'no-static-style': 'noStaticStyle',
  'no-static-attribute': 'noStaticAttribute',
  'no-inline-style': 'noInlineStyle',
  'literal-too-large': 'literalTooLarge',
  'source-mode-removed': 'sourceModeRemoved',
  'unsupported-path': 'unsupportedPath',
  'parse-error': 'parseError',
  'unsupported-module': 'unsupportedModule',
  'unsupported-entry': 'unsupportedEntry',
  'custom-component-ancestor': 'customComponentAncestor',
  'text-definition-only': 'textDefinitionOnly',
  'unsupported-targets': 'unsupportedTargets',
  'invalid-scope': 'invalidScope',
  'invalid-operation': 'invalidOperation',
  'stale-source': 'staleSource',
  'invalid-target': 'invalidTarget',
  'unsupported-field': 'unsupportedField',
  'invalid-style': 'invalidStyle',
  'runtime-reserved-value': 'runtimeReservedValue',
  'reparse-failed': 'reparseFailed',
  'workspace-error': 'workspaceError',
  cancelled: 'cancelled',
  unavailable: 'unavailable',
  busy: 'busy',
  'unsupported-source': 'unsupportedSource',
  'workspace-required': 'workspaceRequired',
  'workspace-changed': 'workspaceChanged',
  'unsafe-path': 'unsafePath',
  'invalid-input': 'invalidInput',
  'stage-changed': 'stageChanged',
} as const;

export function sourceEditReasonMessage(reason: string, t: Translate): string {
  const key = Object.hasOwn(sourceEditReasonKeys, reason)
    ? sourceEditReasonKeys[reason as keyof typeof sourceEditReasonKeys]
    : 'unknown';
  return t(`canvas.sourceEdit.reasons.${key}`);
}

export function sourceEditOriginMessage(t: Translate): string {
  return t('canvas.sourceEdit.origin');
}
