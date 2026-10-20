import { z } from 'zod';

const text = z.string().min(1).max(12000);
const id = z.string().min(1).max(160);
const nullableText = z.string().max(24000).nullable();
export const WebSourceSchema = z.object({
  id,
  url: z.string().url().max(4096),
  title: nullableText,
  publisher: nullableText,
  publishedAt: nullableText,
  retrievedAt: z.string(),
  excerpt: nullableText,
  locator: nullableText,
  originalRead: z.boolean(),
  originalText: z.string().max(24000).optional(),
});
export type WebSource = z.infer<typeof WebSourceSchema>;
export interface WebFetchResult {
  source: WebSource;
  finalUrl: string;
  contentType: string;
  text: string;
  truncated: boolean;
}
export interface WebResearchNetwork {
  search(query: string, count: number, signal?: AbortSignal): Promise<WebSource[]>;
  fetch(url: string, signal?: AbortSignal): Promise<WebFetchResult>;
}
export const EvidenceInputSchema = z
  .object({
    claim: text,
    sourceIds: z.array(id).max(20),
    quote: z.string().max(12000).default(''),
    locator: z.string().max(1000).default(''),
    year: z.string().max(100).default(''),
    region: z.string().max(200).default(''),
    unit: z.string().max(100).default(''),
    scope: z.string().max(2000).default(''),
    kind: z.enum(['fact', 'calculation', 'forecast', 'inference']),
    inputEvidenceIds: z.array(id).max(20).default([]),
    formula: z.string().max(2000).default(''),
    uncertainty: z.string().max(2000).default(''),
    conflict: z.boolean().default(false),
    insufficient: z.boolean().default(false),
  })
  .strict();
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;
export const EvidenceSchema = EvidenceInputSchema.extend({
  id,
  originalRead: z.boolean(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const SlideSnapshotSchema = z.object({
  id,
  title: z.string().max(2000),
  fingerprint: z.string(),
});
export type ResearchSlide = z.infer<typeof SlideSnapshotSchema>;
export const SlideUsageSchema = SlideSnapshotSchema.extend({
  path: z.string().max(4096),
  evidenceIds: z.array(id).max(100),
});
export const ResearchStoreSchema = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(WebSourceSchema).max(1000),
  evidence: z.array(EvidenceSchema).max(2000),
  usages: z.array(SlideUsageSchema).max(1000),
});
export type ResearchStore = z.infer<typeof ResearchStoreSchema>;
export interface ResearchHost extends WebResearchNetwork {
  recordEvidence(input: EvidenceInput, signal?: AbortSignal): Promise<Evidence>;
  linkSlide(
    path: string,
    slideId: string,
    evidenceIds: string[],
    signal?: AbortSignal,
  ): Promise<ResearchSlide>;
  exportSources(path: string, signal?: AbortSignal): Promise<{ path: string; warnings: string[] }>;
  readRecords(signal?: AbortSignal): Promise<ResearchStore>;
}
