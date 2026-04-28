import { CURRENT_TOOL_ORDER, TOOL_MANIFEST_V1 } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { availableToolNames } from './tool-manifest';

describe('tool-manifest', () => {
  it('keeps the default current tool order in one manifest', () => {
    expect(CURRENT_TOOL_ORDER).toEqual([
      'set_title',
      'set_todos',
      'skill',
      'scaffold',
      'str_replace_based_edit_tool',
      'done',
      'preview',
      'generate_image_asset',
      'tweaks',
      'ask',
    ]);
    const currentNames = TOOL_MANIFEST_V1.tools
      .filter((tool) => tool.status === 'current')
      .map((tool) => tool.name);
    expect(currentNames).toEqual([...CURRENT_TOOL_ORDER]);
  });

  it('hides fs-bound tools when fs is unavailable', () => {
    const tools = availableToolNames({
      fs: false,
      preview: true,
      image: true,
      workspaceReader: true,
      ask: true,
    });
    expect(tools).not.toContain('str_replace_based_edit_tool');
    expect(tools).not.toContain('done');
    expect(tools).toContain('preview');
    expect(tools).toContain('generate_image_asset');
  });

  it('gates preview, image, tweaks, and ask on host capabilities', () => {
    const tools = availableToolNames({
      fs: true,
      preview: false,
      image: false,
      workspaceReader: false,
      ask: false,
    });
    expect(tools).toEqual([
      'set_title',
      'set_todos',
      'skill',
      'scaffold',
      'str_replace_based_edit_tool',
      'done',
    ]);
  });
});
