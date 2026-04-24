import { z } from 'zod';

export const DesignSnapshotV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  designId: z.string().min(1),
  parentId: z.string().nullable(),
  type: z.enum(['initial', 'edit', 'fork']),
  prompt: z.string().nullable(),
  artifactType: z.enum(['html', 'react', 'svg']),
  artifactSource: z.string(),
  createdAt: z.string(),
  message: z.string().optional(),
});
export type DesignSnapshot = z.infer<typeof DesignSnapshotV1>;

export const DesignV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().default('Untitled design'),
  createdAt: z.string(),
  updatedAt: z.string(),
  thumbnailText: z.string().nullable().default(null),
  deletedAt: z.string().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
});
export type Design = z.infer<typeof DesignV1>;

export const DesignMessageV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  designId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  ordinal: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type DesignMessage = z.infer<typeof DesignMessageV1>;

export const ChatMessageKind = z.enum([
  'user',
  'assistant_text',
  'tool_call',
  'artifact_delivered',
  'error',
]);
export type ChatMessageKind = z.infer<typeof ChatMessageKind>;

/**
 * Row from the chat_messages table. `payload` is a JSON string on disk; the
 * typed variants are parsed at the IPC boundary. Schema must anticipate
 * Phase 2 tool events (tool_call with verbGroup) even though Phase 1 only
 * emits user / assistant_text / artifact_delivered.
 */
export const ChatMessageRowV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.number().int(),
  designId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  kind: ChatMessageKind,
  payload: z.unknown(),
  snapshotId: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatMessageRow = z.infer<typeof ChatMessageRowV1>;

export interface ChatAppendInput {
  designId: string;
  kind: ChatMessageKind;
  payload: unknown;
  snapshotId?: string | null;
}

// Payload shapes (not strictly validated — payload is opaque JSON in DB).
export interface ChatUserPayload {
  text: string;
  attachedSkills?: string[];
}
export interface ChatAssistantTextPayload {
  text: string;
}
export interface ChatArtifactDeliveredPayload {
  filename?: string;
  createdAt: string;
}
export interface ChatErrorPayload {
  message: string;
  code?: string;
}
export interface ChatToolCallPayload {
  toolName: string;
  command?: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: unknown;
  error?: { message: string; code?: string };
  startedAt: string;
  durationMs?: number;
  verbGroup: string;
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Virtual FS (Workstream E — Phase 2 agent tools)
//
// Per-design file tree stored in SQLite, written by the text_editor tool via
// the agent runtime. Paths are POSIX-relative ("index.html",
// "_starters/ios-frame.jsx"); never absolute, never contain "..".
// ---------------------------------------------------------------------------

export const DesignFileV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  designId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DesignFile = z.infer<typeof DesignFileV1>;

// ---------------------------------------------------------------------------
// Comments (Workstream D — inline comment mode)
// ---------------------------------------------------------------------------

export const CommentKind = z.enum(['note', 'edit']);
export type CommentKind = z.infer<typeof CommentKind>;

export const CommentStatus = z.enum(['pending', 'applied', 'dismissed']);
export type CommentStatus = z.infer<typeof CommentStatus>;

/** Whether a comment instructs the model to change just the pinned element
 *  ("element") or to consider the change a global directive that may touch
 *  the rest of the design ("global"). Defaults to "element" for back-compat
 *  with rows written before the v2 enrichment landed. */
export const CommentScope = z.enum(['element', 'global']);
export type CommentScope = z.infer<typeof CommentScope>;

export const CommentRect = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});
export type CommentRect = z.infer<typeof CommentRect>;

export const CommentRowV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  designId: z.string().min(1),
  snapshotId: z.string().min(1),
  kind: CommentKind,
  selector: z.string(),
  tag: z.string(),
  outerHTML: z.string(),
  rect: CommentRect,
  text: z.string(),
  status: CommentStatus,
  createdAt: z.string(),
  appliedInSnapshotId: z.string().nullable(),
  /** v2 enrichment — defaults to 'element' for rows from v1. */
  scope: CommentScope.default('element').optional(),
  /** v2 enrichment — parent element's outerHTML (truncated). Optional so
   *  pre-v2 rows still parse without it. */
  parentOuterHTML: z.string().optional(),
});
export type CommentRow = z.infer<typeof CommentRowV1>;

export interface CommentCreateInput {
  designId: string;
  snapshotId: string;
  kind: CommentKind;
  selector: string;
  tag: string;
  outerHTML: string;
  rect: CommentRect;
  text: string;
  scope?: CommentScope;
  parentOuterHTML?: string;
}

export interface CommentUpdateInput {
  text?: string;
  status?: CommentStatus;
}

export interface SnapshotCreateInput {
  designId: string;
  parentId: string | null;
  type: 'initial' | 'edit' | 'fork';
  prompt: string | null;
  artifactType: 'html' | 'react' | 'svg';
  artifactSource: string;
  message?: string;
}
