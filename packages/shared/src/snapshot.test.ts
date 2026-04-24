import { describe, expect, it } from 'vitest';
import { DesignV1 } from './snapshot';

describe('DesignV1', () => {
  it('parses legacy row without workspacePath as null', () => {
    const row = {
      id: 'design-123',
      createdAt: '2026-04-22T10:00:00Z',
      updatedAt: '2026-04-22T10:00:00Z',
    };
    const result = DesignV1.parse(row);
    expect(result.workspacePath).toBeNull();
    expect(result.name).toBe('Untitled design');
    expect(result.schemaVersion).toBe(1);
  });

  it('parses valid string workspacePath correctly', () => {
    const row = {
      id: 'design-456',
      createdAt: '2026-04-22T10:00:00Z',
      updatedAt: '2026-04-22T10:00:00Z',
      workspacePath: '/home/user/projects/my-design',
    };
    const result = DesignV1.parse(row);
    expect(result.workspacePath).toBe('/home/user/projects/my-design');
  });

  it('parses explicit null workspacePath correctly', () => {
    const row = {
      id: 'design-789',
      createdAt: '2026-04-22T10:00:00Z',
      updatedAt: '2026-04-22T10:00:00Z',
      workspacePath: null,
    };
    const result = DesignV1.parse(row);
    expect(result.workspacePath).toBeNull();
  });

  it('rejects invalid type for workspacePath', () => {
    const row = {
      id: 'design-invalid',
      createdAt: '2026-04-22T10:00:00Z',
      updatedAt: '2026-04-22T10:00:00Z',
      workspacePath: 12345,
    };
    expect(() => DesignV1.parse(row)).toThrow();
  });

  it('rejects invalid type (array) for workspacePath', () => {
    const row = {
      id: 'design-invalid-array',
      createdAt: '2026-04-22T10:00:00Z',
      updatedAt: '2026-04-22T10:00:00Z',
      workspacePath: ['path'],
    };
    expect(() => DesignV1.parse(row)).toThrow();
  });
});
