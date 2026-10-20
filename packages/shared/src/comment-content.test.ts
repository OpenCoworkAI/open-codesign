import { expect, it } from 'vitest';
import { CommentContentExpectations, commentContentFingerprint } from './comment-content';
import type { CommentRow } from './snapshot';

const comment: CommentRow = {
  schemaVersion: 1,
  id: 'edit',
  designId: 'design',
  snapshotId: 'snapshot',
  kind: 'edit',
  text: 'Red',
  selector: '#heading',
  tag: 'h1',
  outerHTML: '<h1>Heading</h1>',
  rect: { top: 0, left: 0, width: 10, height: 10 },
  status: 'pending',
  appliedInSnapshotId: null,
  createdAt: '2026-01-01T00:00:00Z',
};
it.each([
  { text: 'Blue' },
  { sourcePath: 'other.jsx' },
  { selector: '#body' },
  { tag: 'h2' },
  { outerHTML: '<h1>New heading</h1>' },
  { scope: 'global' as const },
  { parentOuterHTML: '<section>Context</section>' },
  { snapshotId: 'other' },
  { designId: 'other' },
  { kind: 'note' as const },
])('detects agent-relevant revision %j', (patch) => {
  expect(commentContentFingerprint({ ...comment, ...patch })).not.toBe(
    commentContentFingerprint(comment),
  );
});
it('ignores application bookkeeping and live rectangles but normalizes implicit scope', () => {
  expect(
    commentContentFingerprint({
      ...comment,
      scope: 'element',
      rect: { top: 1, left: 2, width: 3, height: 4 },
      status: 'applied',
      appliedInSnapshotId: 'after',
    }),
  ).toBe(commentContentFingerprint(comment));
});
it.each([null, [], { edit: 42 }, { edit: '' }])('rejects invalid CAS expectations %j', (input) => {
  expect(CommentContentExpectations.safeParse(input).success).toBe(false);
});
