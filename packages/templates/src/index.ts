/**
 * Built-in demo prompts. Aligned with the eight Claude Design demos
 * we committed to replicate (see docs/VISION.md).
 */

export { SYSTEM_PROMPTS, type SystemPromptId } from './system/index';

export interface DemoTemplate {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export const BUILTIN_DEMOS: DemoTemplate[] = [
  {
    id: 'meditation-app',
    title: 'Calm Spaces meditation app',
    description: 'Mobile prototype with phone frame, soft palette, interactive nav.',
    prompt:
      'Design a mobile app prototype for a meditation app called Calm Spaces. Show a phone frame containing a home screen with a meditation list, play button, and progress tracker. Use serene typography, soft greens and blues, and lots of white space.',
  },
  {
    id: 'case-study-onepager',
    title: 'Client case study one-pager',
    description: 'Dark theme one-page PDF-ready layout with hero metrics.',
    prompt:
      'Create a one-page client case study. The client increased qualified leads 40% using our platform. Include before/after metrics, a CEO quote, and a logo placeholder. Clean, minimal, dark theme.',
  },
  {
    id: 'pitch-deck',
    title: 'B2B SaaS pitch deck',
    description: '8-12 slides for a healthcare-targeted SaaS pitch.',
    prompt:
      'Design a pitch deck for a B2B SaaS company targeting mid-market healthcare. 8 to 10 slides covering problem, market, product, traction, team, and ask.',
  },
  {
    id: 'marketing-landing',
    title: 'Marketing landing page',
    description: 'Hero + features + CTA, tunable accent color.',
    prompt:
      'Design a modern marketing landing page for an AI productivity tool. Include a hero section, three feature cards, social proof, and a call to action. Use a warm neutral palette.',
  },
];

export function getDemo(id: string): DemoTemplate | undefined {
  return BUILTIN_DEMOS.find((d) => d.id === id);
}
