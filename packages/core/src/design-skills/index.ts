/**
 * Design-skill starter snippets — JSX modules that the agent can `view` from
 * the virtual filesystem and adapt to the user's brief.
 *
 * Each .jsx file is a complete `<script type="text/babel">` payload with a
 * `// when_to_use:` hint comment at the top so the agent can decide which
 * skill (if any) applies before opening the file.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSkill(name: string): string {
  return readFileSync(resolve(__dirname, name), 'utf-8');
}

const DESIGN_SKILL_FILES = [
  'slide-deck.jsx',
  'dashboard.jsx',
  'landing-page.jsx',
  'chart-svg.jsx',
  'glassmorphism.jsx',
  'editorial-typography.jsx',
  'heroes.jsx',
  'pricing.jsx',
  'footers.jsx',
  'chat-ui.jsx',
  'data-table.jsx',
  'calendar.jsx',
] as const;

export type DesignSkillName = (typeof DESIGN_SKILL_FILES)[number];

export const DESIGN_SKILLS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['slide-deck.jsx', loadSkill('slide-deck.jsx')],
  ['dashboard.jsx', loadSkill('dashboard.jsx')],
  ['landing-page.jsx', loadSkill('landing-page.jsx')],
  ['chart-svg.jsx', loadSkill('chart-svg.jsx')],
  ['glassmorphism.jsx', loadSkill('glassmorphism.jsx')],
  ['editorial-typography.jsx', loadSkill('editorial-typography.jsx')],
  ['heroes.jsx', loadSkill('heroes.jsx')],
  ['pricing.jsx', loadSkill('pricing.jsx')],
  ['footers.jsx', loadSkill('footers.jsx')],
  ['chat-ui.jsx', loadSkill('chat-ui.jsx')],
  ['data-table.jsx', loadSkill('data-table.jsx')],
  ['calendar.jsx', loadSkill('calendar.jsx')],
] as const);
