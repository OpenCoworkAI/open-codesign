/** File allowlist shared by the gallery and the new-workspace seeder. No file contents load here. */
export const DEMO_INPUTS = {
  daymark: {
    files: ['product-brief.md', 'tasks.json', 'projects.json', 'logo.svg', 'DESIGN.md'],
  },
  'common-ground': {
    files: ['product-brief.md', 'schedule.csv', 'poster.svg', 'logo.svg', 'DESIGN.md'],
  },
  trailhead: {
    files: ['product-brief.md', 'sketch-reference.svg', 'trips.json'],
  },
} as const;

export type DemoInputId = keyof typeof DEMO_INPUTS;

export const DEMO_INPUT_LICENSE = {
  schemaVersion: 1,
  license: 'MIT',
  source: 'Original demo inputs authored for Open CoDesign',
  attribution: 'Open CoDesign contributors',
} as const;

export function isDemoInputId(value: unknown): value is DemoInputId {
  return typeof value === 'string' && Object.hasOwn(DEMO_INPUTS, value);
}
