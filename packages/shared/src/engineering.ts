import { z } from 'zod';

// ---------------------------------------------------------------------------
// Engineering Mode (Phase 1, React-only)
//
// Schemas for the engineering-mode session type. See plan
// docs/plans/2026-04-28-001-feat-engineering-mode-react-plan.md (U1).
//
// Stability rules:
// - DesignV1 is extended with `mode` and `engineering` fields that default to
//   'generative' / null so legacy v0.1 design rows still parse.
// - All engineering schemas carry `schemaVersion: 1` to match the rest of the
//   shared schema.
// ---------------------------------------------------------------------------

export const EngineeringFrameworkV1 = z.enum(['react']);
export type EngineeringFramework = z.infer<typeof EngineeringFrameworkV1>;

export const EngineeringPackageManagerV1 = z.enum(['pnpm', 'npm', 'yarn', 'bun']);
export type EngineeringPackageManager = z.infer<typeof EngineeringPackageManagerV1>;

export const LaunchEntryKindV1 = z.enum(['package-script', 'repo-local-command']);
export type LaunchEntryKind = z.infer<typeof LaunchEntryKindV1>;

export const LaunchEntryConfidenceV1 = z.enum(['high', 'medium', 'low']);
export type LaunchEntryConfidence = z.infer<typeof LaunchEntryConfidenceV1>;

export const LaunchEntrySourceV1 = z.enum(['saved', 'package-script', 'manual']);
export type LaunchEntrySource = z.infer<typeof LaunchEntrySourceV1>;

/** A single candidate (or saved) launch entry for an engineering-mode design. */
export const LaunchEntryV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  kind: LaunchEntryKindV1,
  /** For 'package-script' this is the script name (e.g. 'dev'). For
   *  'repo-local-command' this is the full shell command line. */
  value: z.string().min(1),
  confidence: LaunchEntryConfidenceV1,
  source: LaunchEntrySourceV1,
  /** Optional human-readable label shown in the launch entry picker. */
  label: z.string().optional(),
});
export type LaunchEntry = z.infer<typeof LaunchEntryV1>;

/** Engineering-mode configuration persisted on the design row and mirrored to
 *  `<workspace>/.codesign/settings.json` under the `engineering` key. */
export const EngineeringConfigV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  framework: EngineeringFrameworkV1,
  packageManager: EngineeringPackageManagerV1,
  launchEntry: LaunchEntryV1,
  /** Last successfully detected ready URL — used for warm restart and as the
   *  initial preview src when reopening the design. */
  lastReadyUrl: z.string().nullable().default(null),
  /** Optional user-supplied ready URL (e.g. when the dev server prints no
   *  parseable URL or runs behind a proxy). When present, the runtime falls
   *  back to this URL after a short wait if no URL was detected on stdout. */
  manualReadyUrl: z.string().nullable().default(null),
});
export type EngineeringConfig = z.infer<typeof EngineeringConfigV1>;

// ---------------------------------------------------------------------------
// Run-state FSM (subprocess lifecycle, owned by main process — U3)
// ---------------------------------------------------------------------------

export const EngineeringStatusV1 = z.enum([
  'detecting',
  'awaiting-ack',
  'initializing-deps',
  'starting',
  'running',
  'stopped',
  'error',
  'unsupported',
]);
export type EngineeringStatus = z.infer<typeof EngineeringStatusV1>;

export const EngineeringErrorKindV1 = z.enum([
  'detect',
  'init',
  'launch',
  'crash',
  'timeout',
  'permission-denied',
]);
export type EngineeringErrorKind = z.infer<typeof EngineeringErrorKindV1>;

export const EngineeringErrorV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  kind: EngineeringErrorKindV1,
  message: z.string(),
  /** Last N lines of stderr/stdout captured when the error fired. */
  excerpt: z.array(z.string()).default([]),
  /** Optional command that failed, for UI display. */
  command: z.string().optional(),
});
export type EngineeringError = z.infer<typeof EngineeringErrorV1>;

export const EngineeringLogLineV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Monotonic sequence within the current run. */
  seq: z.number().int().nonnegative(),
  stream: z.enum(['stdout', 'stderr']),
  text: z.string(),
  /** ISO timestamp. */
  ts: z.string(),
});
export type EngineeringLogLine = z.infer<typeof EngineeringLogLineV1>;

export const EngineeringRunStateV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  designId: z.string().min(1),
  status: EngineeringStatusV1,
  /** Populated once a ready URL is detected on stdout. */
  readyUrl: z.string().nullable().default(null),
  lastError: EngineeringErrorV1.nullable().default(null),
  /** Most recent ring-buffer entries (capped on the producer side). */
  logs: z.array(EngineeringLogLineV1).default([]),
  /** Updated every time the FSM transitions. */
  updatedAt: z.string(),
});
export type EngineeringRunState = z.infer<typeof EngineeringRunStateV1>;

// ---------------------------------------------------------------------------
// Component selection (replaces outerHTML as the primary comment / agent
// target context — U8 / U9 / U10). `legacyOuterHTML` stays as a fallback
// channel when the React inspector cannot resolve a fiber.
// ---------------------------------------------------------------------------

export const ComponentDebugSourceV1 = z.object({
  /** Absolute file path as reported by React fiber `_debugSource`. The desktop
   *  side is responsible for converting it to a workspace-relative path before
   *  surfacing in UI or agent prompts. */
  fileName: z.string().min(1),
  lineNumber: z.number().int().nonnegative(),
  columnNumber: z.number().int().nonnegative().optional(),
});
export type ComponentDebugSource = z.infer<typeof ComponentDebugSourceV1>;

export const ComponentSelectionV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Best-effort component name (`displayName || name`). */
  componentName: z.string().min(1),
  /** Workspace-relative file path; resolved on the desktop side from
   *  `debugSource.fileName` when possible. */
  filePath: z.string().nullable().default(null),
  /** Owner chain from leaf to root, capped at a reasonable depth on the
   *  producer side. */
  ownerChain: z.array(z.string()).default([]),
  debugSource: ComponentDebugSourceV1.nullable().default(null),
  /** DOM selector (XPath or similar) — kept for parity with the legacy
   *  `ELEMENT_SELECTED` payload so consumers that only need a stable handle
   *  to the DOM node still have one. */
  domSelector: z.string().min(1),
  /** Truncated outerHTML preserved purely as a debug / fallback field. Never
   *  surfaced as the primary context in engineering-mode UI or agent prompts. */
  legacyOuterHTML: z.string().optional(),
});
export type ComponentSelection = z.infer<typeof ComponentSelectionV1>;
