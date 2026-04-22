import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
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

export function makeGenerateImageAssetTool(
  generateAsset: GenerateImageAssetFn,
  fs: TextEditorFsCallbacks | undefined,
): AgentTool<typeof GenerateImageAssetParams, GenerateImageAssetDetails> {
  return {
    name: 'generate_image_asset',
    label: 'Generate image asset',
    description:
      'Generate one high-quality bitmap asset for the design, such as a hero image, ' +
      'product render, poster illustration, textured background, or marketing visual. ' +
      'Use this only when a generated bitmap would materially improve the artifact. ' +
      'Do not use it for simple icons, charts, gradients, or UI chrome that can be ' +
      'drawn with HTML/CSS/SVG. The tool returns a local assets/... path to reference.',
    parameters: GenerateImageAssetParams,
    async execute(
      _toolCallId,
      params,
      signal,
    ): Promise<AgentToolResult<GenerateImageAssetDetails>> {
      const prompt = params.prompt.trim();
      if (prompt.length === 0) throw new Error('Image asset prompt cannot be empty');
      const request: GenerateImageAssetRequest = {
        prompt,
        purpose: params.purpose,
        ...(params.filenameHint !== undefined ? { filenameHint: params.filenameHint } : {}),
        ...(params.aspectRatio !== undefined ? { aspectRatio: params.aspectRatio } : {}),
        ...(params.alt !== undefined ? { alt: params.alt } : {}),
      };
      const asset = await generateAsset(request, signal);
      if (fs !== undefined) {
        fs.create(asset.path, asset.dataUrl);
      }
      const alt = params.alt?.trim() || `${params.purpose} image`;
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
