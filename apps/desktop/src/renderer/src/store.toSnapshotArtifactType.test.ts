import { describe, expect, it } from 'vitest';
import { toSnapshotArtifactType } from './store';

describe('toSnapshotArtifactType', () => {
  it('folds html/slides/bundle/undefined into html', () => {
    expect(toSnapshotArtifactType(undefined)).toBe('html');
    expect(toSnapshotArtifactType('html')).toBe('html');
    expect(toSnapshotArtifactType('slides')).toBe('html');
    expect(toSnapshotArtifactType('bundle')).toBe('html');
  });

  it('passes svg and react through', () => {
    expect(toSnapshotArtifactType('svg')).toBe('svg');
    expect(toSnapshotArtifactType('react')).toBe('react');
  });

  it('throws on unknown coreType instead of silently returning html', () => {
    expect(() => toSnapshotArtifactType('mystery')).toThrow(
      /Unsupported artifact type for snapshot persistence: mystery/,
    );
  });
});
