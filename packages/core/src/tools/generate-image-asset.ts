import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import { type CoreLogger, NOOP_LOGGER } from '../logger.js';
import type { TextEditorFsCallbacks } from './text-editor';

const GenerateImageAssetParams = Type.Object({
  prompt: Type.String(),
  purpose: Type.Union([
    Type.Literal('hero'),
    Type.Literal('product'),
    Type.Literal('poster'),
    Type.Literal('background'),
    Type.Literal('illustration'),
    Type.Literal('logo'),
    Type.Literal('other'),
  ]),
  filenameHint: Type.Optional(Type.String()),
  aspectRatio: Type.Optional(
    Type.Union([
      Type.Literal('1:1'),
      Type.Literal('16:9'),
      Type.Literal('9:16'),
      Type.Literal('4:3'),
      Type.Literal('3:4'),
    ]),
  ),
  alt: Type.Optional(Type.String()),
});

export type ImageAssetPurpose =
  | 'hero'
  | 'product'
  | 'poster'
  | 'background'
  | 'illustration'
  | 'logo'
  | 'other';

export interface GenerateImageAssetRequest {
  prompt: string;
  purpose: ImageAssetPurpose;
  filenameHint?: string | undefined;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | undefined;
  alt?: string | undefined;
}

export interface GenerateImageAssetResult {
  path: string;
  dataUrl: string;
  mimeType: string;
  model: string;
  provider: string;
  revisedPrompt?: string | undefined;
}

export interface GenerateImageAssetDetails {
  path: string;
  purpose: ImageAssetPurpose;
  mimeType: string;
  model: string;
  provider: string;
  alt: string;
  revisedPrompt?: string | undefined;
}

export type GenerateImageAssetFn = (
  request: GenerateImageAssetRequest,
  signal?: AbortSignal,
) => Promise<GenerateImageAssetResult>;

const PURPOSE_STYLE_SUFFIX: Record<ImageAssetPurpose, string> = {
  hero:
    'Editorial hero composition: clear focal subject, strong depth, soft diffused lighting, ' +
    'generous negative space on one side for overlay copy, no legible text in the image.',
  product:
    'Commercial product photography: centered subject on a clean or minimally textured surface, ' +
    'even studio lighting, subtle shadow, true-to-life colors, no watermarks or text.',
  poster:
    'Poster-style illustration: bold silhouette, confident color palette, strong graphic ' +
    'composition with breathing room for a title, no embedded text unless explicitly requested.',
  background:
    'Seamless full-bleed background texture/scene: uniform density, low-contrast in the ' +
    'center-top to preserve readability when overlaid with UI content, no legible text, no ' +
    'hard vignettes, safe to crop from multiple edges.',
  illustration:
    'Hand-crafted editorial illustration: cohesive palette, clear subject hierarchy, subtle ' +
    'grain, no legible text in the image.',
  logo:
    'Logo-style mark: centered composition on neutral background, clean vector-like silhouette, ' +
    'limited palette, square aspect, no surrounding context, no embedded text unless the prompt ' +
    'explicitly lists the wordmark.',
  other: '',
};

/**
 * Append a short constraint/style suffix derived from the `purpose` so the
 * bitmap model receives a production-shaped prompt even when the main agent
 * wrote only a terse brief. The agent's original phrasing leads; the suffix
 * only adds structural guarantees (composition, safety for overlay, no text).
 */
export function enrichImagePromptForPurpose(prompt: string, purpose: ImageAssetPurpose): string {
  const base = prompt.trim();
  const suffix = PURPOSE_STYLE_SUFFIX[purpose];
  if (suffix.length === 0) return base;
  const already = base.toLowerCase();
  // Simple duplication guard — avoid re-appending if the agent already
  // included near-identical guidance (e.g. "seamless background"). Cheap
  // substring match; exact-match matters less than keeping prompts short.
  const marker = suffix.split(':')[0]?.toLowerCase() ?? '';
  if (marker.length > 0 && already.includes(marker)) return base;
  return `${base}\n\n${suffix}`;
}

export function makeGenerateImageAssetTool(
  generateAsset: GenerateImageAssetFn,
  fs: TextEditorFsCallbacks | undefined,
  logger: CoreLogger = NOOP_LOGGER,
): AgentTool<typeof GenerateImageAssetParams, GenerateImageAssetDetails> {
  return {
    name: 'generate_image_asset',
    label: 'Generate image asset',
    description:
      'Generate one high-quality bitmap asset for the design, such as a hero image, ' +
      'product render, poster illustration, textured background, or marketing visual. ' +
      'Use this only when a generated bitmap would materially improve the artifact. ' +
      'Do not use it for simple icons, charts, gradients, or UI chrome that can be ' +
      'drawn with HTML/CSS/SVG. The call is synchronous and takes ~20-60s per image, ' +
      'so prefer batching all needed assets in one assistant turn before writing index.html. ' +
      'The tool returns a local assets/... path to reference.',
    parameters: GenerateImageAssetParams,
    async execute(
      _toolCallId,
      params,
      signal,
    ): Promise<AgentToolResult<GenerateImageAssetDetails>> {
      const rawPrompt = params.prompt.trim();
      if (rawPrompt.length === 0) throw new Error('Image asset prompt cannot be empty');
      const enrichedPrompt = enrichImagePromptForPurpose(rawPrompt, params.purpose);
      const request: GenerateImageAssetRequest = {
        prompt: enrichedPrompt,
        purpose: params.purpose,
        ...(params.filenameHint !== undefined ? { filenameHint: params.filenameHint } : {}),
        ...(params.aspectRatio !== undefined ? { aspectRatio: params.aspectRatio } : {}),
        ...(params.alt !== undefined ? { alt: params.alt } : {}),
      };
      const started = Date.now();
      logger.info('[image_asset] step=start', {
        purpose: params.purpose,
        aspectRatio: params.aspectRatio ?? 'default',
        promptChars: enrichedPrompt.length,
        promptPreview: enrichedPrompt.slice(0, 160),
        enriched: enrichedPrompt.length !== rawPrompt.length,
      });
      let asset: GenerateImageAssetResult;
      try {
        asset = await generateAsset(request, signal);
      } catch (err) {
        logger.error('[image_asset] step=fail', {
          purpose: params.purpose,
          ms: Date.now() - started,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      if (fs !== undefined) {
        try {
          await fs.create(asset.path, asset.dataUrl);
        } catch (err) {
          logger.error('[image_asset] step=fail', {
            purpose: params.purpose,
            ms: Date.now() - started,
            stage: 'persist',
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }
      const alt = params.alt?.trim() || `${params.purpose} image`;
      logger.info('[image_asset] step=ok', {
        purpose: params.purpose,
        path: asset.path,
        provider: asset.provider,
        model: asset.model,
        mimeType: asset.mimeType,
        ms: Date.now() - started,
        revised: asset.revisedPrompt !== undefined,
      });
      const revised = asset.revisedPrompt ? `\nRevised prompt: ${asset.revisedPrompt}` : '';
      return {
        content: [
          {
            type: 'text',
            text:
              `Generated local bitmap asset at ${asset.path} (${asset.mimeType}). ` +
              `Reference this path in index.html, for example src="${asset.path}" ` +
              `or backgroundImage: "url('${asset.path}')". Alt text: ${alt}.${revised}`,
          },
        ],
        details: {
          path: asset.path,
          purpose: params.purpose,
          mimeType: asset.mimeType,
          model: asset.model,
          provider: asset.provider,
          alt,
          ...(asset.revisedPrompt !== undefined ? { revisedPrompt: asset.revisedPrompt } : {}),
        },
      };
    },
  };
}
