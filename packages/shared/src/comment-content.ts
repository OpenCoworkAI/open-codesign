import { z } from 'zod';
import { type CommentRow, CommentRowV1 } from './snapshot';

export function commentContentFingerprint(comment: CommentRow): string {
  return JSON.stringify([
    comment.designId,
    comment.snapshotId,
    comment.kind,
    comment.sourcePath ?? null,
    comment.selector,
    comment.tag,
    comment.outerHTML,
    comment.text,
    comment.scope ?? 'element',
    comment.parentOuterHTML ?? null,
  ]);
}

export const CommentContentExpectations = z.record(z.string().min(1), z.string().min(1));
export type CommentContentExpectations = z.infer<typeof CommentContentExpectations>;

export const CommentApplyResultV1 = z
  .object({
    schemaVersion: z.literal(1),
    applied: z.array(CommentRowV1),
    conflictedIds: z.array(z.string()),
  })
  .strict();
export type CommentApplyResultV1 = z.infer<typeof CommentApplyResultV1>;
