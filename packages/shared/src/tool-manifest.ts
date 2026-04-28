export const TOOL_MANIFEST_SCHEMA_VERSION = 1 as const;

export type ToolManifestStatusV1 = 'current' | 'legacy';
export type ToolManifestIconKeyV1 =
  | 'check'
  | 'eye'
  | 'file-edit'
  | 'file-plus'
  | 'image'
  | 'list-checks'
  | 'message-circle-question'
  | 'sliders-horizontal'
  | 'sparkles'
  | 'type'
  | 'wrench';

export interface ToolManifestEntryV1 {
  name: string;
  label: string;
  iconKey: ToolManifestIconKeyV1;
  status: ToolManifestStatusV1;
  requires: Array<'fs' | 'preview' | 'image' | 'workspaceReader' | 'ask'>;
}

export interface ToolManifestV1 {
  schemaVersion: typeof TOOL_MANIFEST_SCHEMA_VERSION;
  tools: ToolManifestEntryV1[];
}

export const CURRENT_TOOL_ORDER = [
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
] as const;

export type CurrentToolNameV1 = (typeof CURRENT_TOOL_ORDER)[number];

export const TOOL_MANIFEST_V1: ToolManifestV1 = {
  schemaVersion: TOOL_MANIFEST_SCHEMA_VERSION,
  tools: [
    { name: 'set_title', label: 'set_title', iconKey: 'type', status: 'current', requires: [] },
    {
      name: 'set_todos',
      label: 'set_todos',
      iconKey: 'list-checks',
      status: 'current',
      requires: [],
    },
    { name: 'skill', label: 'skill', iconKey: 'sparkles', status: 'current', requires: [] },
    { name: 'scaffold', label: 'scaffold', iconKey: 'file-plus', status: 'current', requires: [] },
    {
      name: 'str_replace_based_edit_tool',
      label: 'edit',
      iconKey: 'file-edit',
      status: 'current',
      requires: ['fs'],
    },
    { name: 'done', label: 'done', iconKey: 'check', status: 'current', requires: ['fs'] },
    { name: 'preview', label: 'preview', iconKey: 'eye', status: 'current', requires: ['preview'] },
    {
      name: 'generate_image_asset',
      label: 'generate_image_asset',
      iconKey: 'image',
      status: 'current',
      requires: ['image'],
    },
    {
      name: 'tweaks',
      label: 'tweaks',
      iconKey: 'sliders-horizontal',
      status: 'current',
      requires: ['workspaceReader'],
    },
    {
      name: 'ask',
      label: 'ask',
      iconKey: 'message-circle-question',
      status: 'current',
      requires: ['ask'],
    },
    {
      name: 'text_editor',
      label: 'legacy tool',
      iconKey: 'wrench',
      status: 'legacy',
      requires: [],
    },
    { name: 'load_skill', label: 'legacy tool', iconKey: 'wrench', status: 'legacy', requires: [] },
    {
      name: 'verify_html',
      label: 'legacy tool',
      iconKey: 'wrench',
      status: 'legacy',
      requires: [],
    },
    { name: 'read_url', label: 'legacy tool', iconKey: 'wrench', status: 'legacy', requires: [] },
    {
      name: 'read_design_system',
      label: 'legacy tool',
      iconKey: 'wrench',
      status: 'legacy',
      requires: [],
    },
    { name: 'list_files', label: 'legacy tool', iconKey: 'wrench', status: 'legacy', requires: [] },
  ],
};

export function getToolManifestEntry(name: string): ToolManifestEntryV1 | undefined {
  return TOOL_MANIFEST_V1.tools.find((tool) => tool.name === name);
}

export function isCurrentToolName(name: string): name is CurrentToolNameV1 {
  return CURRENT_TOOL_ORDER.includes(name as CurrentToolNameV1);
}

export function currentToolManifestEntries(): ToolManifestEntryV1[] {
  return CURRENT_TOOL_ORDER.map((name) => {
    const entry = getToolManifestEntry(name);
    if (!entry) throw new Error(`Missing current tool manifest entry: ${name}`);
    return entry;
  });
}
