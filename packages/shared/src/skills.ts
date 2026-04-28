import { z } from 'zod';

export const SkillFrontmatterV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  name: z.string().min(1),
  description: z.string().min(1).max(1536),
  aliases: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().min(1)).default([]),
  validationHints: z.array(z.string().min(1)).default([]),
  trigger: z
    .object({
      providers: z.array(z.string()).default(['*']),
      scope: z.enum(['system', 'prefix']).default('system'),
    })
    .default({ providers: ['*'], scope: 'system' }),
  disable_model_invocation: z.boolean().default(false),
  user_invocable: z.boolean().default(true),
  allowed_tools: z.array(z.string()).optional(),
});

export type SkillFrontmatterV1 = z.infer<typeof SkillFrontmatterV1>;

export interface LoadedSkill {
  /** File slug — filename minus extension (e.g. "frontend-design-anti-slop"). */
  id: string;
  source: 'builtin' | 'user' | 'project';
  frontmatter: SkillFrontmatterV1;
  /** Markdown body after the closing --- delimiter. */
  body: string;
}
