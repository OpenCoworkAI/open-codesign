import { z } from 'zod';

export const DEFAULT_SOURCE_ENTRY = 'App.jsx' as const;
export const LEGACY_SOURCE_ENTRY = 'index.html' as const;
export const NEW_HTML_SOURCE_ENTRY = 'index.html' as const;

const NonEmptyText = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const Revision = z.string().uuid();
const WindowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i;

// Syntax validation cannot replace the host's realpath and workspace-boundary checks.
export const SourceEntryPath = z.string().refine((path) => {
  if (!/\.(html?|jsx|tsx)$/i.test(path) || /[<>:"\\|?*]/.test(path)) return false;
  if ([...path].some((character) => character.charCodeAt(0) < 32)) return false;
  return path.split('/').every((segment) => {
    if (!segment || segment === '.' || segment === '..' || /[ .]$/.test(segment)) return false;
    const basename = segment.split('.')[0] ?? '';
    return !WindowsReservedName.test(basename.trimEnd());
  });
}, 'Must be a safe POSIX-relative HTML, JSX, or TSX source path');
export type SourceEntryPath = z.infer<typeof SourceEntryPath>;

const identityFields = { schemaVersion: z.literal(1), path: SourceEntryPath };

export const SourceIdentityV1 = z.discriminatedUnion('runtimeMode', [
  z
    .object({ ...identityFields, format: z.literal('html'), runtimeMode: z.literal('native-html') })
    .strict(),
  z
    .object({
      ...identityFields,
      format: z.enum(['html', 'jsx', 'tsx']),
      runtimeMode: z.literal('legacy-auto'),
    })
    .strict(),
]);
export type SourceIdentityV1 = z.infer<typeof SourceIdentityV1>;

const declarationFields = {
  schemaVersion: z.literal(1),
  designId: NonEmptyText,
  revision: Revision,
};

export const DesignSourceEntryV1 = z.discriminatedUnion('phase', [
  z
    .object({
      ...declarationFields,
      phase: z.enum(['planned', 'confirmed']),
      workspacePath: NonEmptyText,
      source: SourceIdentityV1,
    })
    .strict(),
  z
    .object({
      ...declarationFields,
      phase: z.literal('invalidated'),
      workspacePath: NonEmptyText.nullable(),
      source: SourceIdentityV1.nullable(),
    })
    .strict(),
]);
export type DesignSourceEntryV1 = z.infer<typeof DesignSourceEntryV1>;

const resultFields = {
  schemaVersion: z.literal(1),
  designId: NonEmptyText,
  workspacePath: NonEmptyText.nullable(),
  revision: Revision.nullable(),
};

export const SourceEntryResultV1 = z.discriminatedUnion('status', [
  z
    .object({
      ...resultFields,
      status: z.literal('planned'),
      workspacePath: NonEmptyText,
      revision: Revision,
      source: SourceIdentityV1,
      content: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      ...resultFields,
      status: z.literal('ready'),
      workspacePath: NonEmptyText,
      source: SourceIdentityV1,
      content: NonEmptyText,
      origin: z.enum(['declared', 'legacy']),
    })
    .strict()
    .refine((result) => result.origin !== 'declared' || result.revision !== null, {
      message: 'A declared source must have a revision',
      path: ['revision'],
    }),
  z
    .object({
      ...resultFields,
      status: z.literal('needs-selection'),
      workspacePath: NonEmptyText,
      candidates: z.array(SourceIdentityV1),
      reason: z.enum(['no-candidates', 'ambiguous-candidates']),
      message: NonEmptyText,
    })
    .strict(),
  z
    .object({
      ...resultFields,
      status: z.literal('invalid'),
      reason: NonEmptyText,
      message: NonEmptyText,
    })
    .strict(),
  z
    .object({
      ...resultFields,
      status: z.literal('not-applicable'),
      reason: z.enum(['connected-url', 'external-app', 'none']),
      message: NonEmptyText,
    })
    .strict(),
]);
export type SourceEntryResultV1 = z.infer<typeof SourceEntryResultV1>;

export const SourceEntryGetRequestV1 = z
  .object({ schemaVersion: z.literal(1), designId: NonEmptyText })
  .strict();
export type SourceEntryGetRequestV1 = z.infer<typeof SourceEntryGetRequestV1>;

export const SourceEntrySelectRequestV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: NonEmptyText,
    path: SourceEntryPath,
    expectedWorkspacePath: NonEmptyText,
    expectedRevision: Revision.nullable(),
  })
  .strict();
export type SourceEntrySelectRequestV1 = z.infer<typeof SourceEntrySelectRequestV1>;
