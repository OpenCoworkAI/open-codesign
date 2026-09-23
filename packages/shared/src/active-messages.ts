import { z } from 'zod';

export const ActiveRunMessageInputV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1).max(200),
    generationId: z.string().min(1).max(200),
    messageId: z.string().min(1).max(200),
    mode: z.enum(['follow-up', 'steer']),
    text: z.string().trim().min(1).max(32_000),
  })
  .strict();
export type ActiveRunMessageInputV1 = z.infer<typeof ActiveRunMessageInputV1>;

export const ActiveRunMessageV1 = ActiveRunMessageInputV1.extend({
  status: z.enum(['pending', 'delivered', 'not-delivered']),
  createdAt: z.string().datetime(),
  reason: z.string().optional(),
}).strict();
export type ActiveRunMessageV1 = z.infer<typeof ActiveRunMessageV1>;

export const ListActiveMessagesInputV1 = z
  .object({
    schemaVersion: z.literal(1),
    designId: z.string().min(1).max(200),
  })
  .strict();
