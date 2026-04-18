import { z } from 'zod';

export const DesignSnapshotV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  designId: z.string().min(1),
  parentId: z.string().nullable(),
  type: z.enum(['initial', 'edit', 'fork']),
  prompt: z.string().nullable(),
  artifactType: z.enum(['html', 'react', 'svg']),
  artifactSource: z.string(),
  createdAt: z.string(),
  message: z.string().optional(),
});
export type DesignSnapshot = z.infer<typeof DesignSnapshotV1>;

export const DesignV1 = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().default('Untitled design'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Design = z.infer<typeof DesignV1>;

export interface SnapshotCreateInput {
  designId: string;
  parentId: string | null;
  type: 'initial' | 'edit' | 'fork';
  prompt: string | null;
  artifactType: 'html' | 'react' | 'svg';
  artifactSource: string;
  message?: string;
}
