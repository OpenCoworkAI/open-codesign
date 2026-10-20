import { z } from 'zod';

export const AskCancelledV1 = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();
export type AskCancelledV1 = z.infer<typeof AskCancelledV1>;
