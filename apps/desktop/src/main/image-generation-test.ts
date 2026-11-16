import { generateImage, normalizeProviderError } from '@open-codesign/providers';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { resolveImageGenerationConfig, toGenerateImageOptions } from './image-generation-settings';
import { getCachedConfig } from './onboarding-ipc';

export interface ImageGenerationTestResult {
  provider: string;
  model: string;
  mimeType: string;
}

let pending: Promise<ImageGenerationTestResult> | undefined;

function redactTestCredential(message: string, key: string): string {
  if (key.length === 0) return message;
  const redacted = message.replaceAll(key, '***REDACTED***');
  if (key.length <= 32) return redacted;
  // Provider diagnostics truncate response bodies. A long OAuth token may
  // appear only as a prefix, so exact full-token replacement is insufficient.
  return redacted
    .split(key.slice(0, 32))
    .map((part, index) =>
      index === 0 ? part : `***REDACTED***${part.replace(/^[A-Za-z0-9._~+/=-]*/, '')}`,
    )
    .join('');
}

/** Explicitly tests the saved image invocation, rather than a text-model listing. */
export function testImageGenerationProvider(): Promise<ImageGenerationTestResult> {
  // Duplicate IPC invocations must not produce duplicate billable images.
  if (pending) return pending;
  pending = runImageTest().finally(() => {
    pending = undefined;
  });
  return pending;
}

async function runImageTest(): Promise<ImageGenerationTestResult> {
  const config = getCachedConfig();
  if (!config?.imageGeneration) {
    throw new CodesignError('Configure image generation first.', ERROR_CODES.CONFIG_MISSING);
  }
  // Testing a saved configuration does not turn on image generation for designs.
  const resolved = await resolveImageGenerationConfig({
    ...config,
    imageGeneration: { ...config.imageGeneration, enabled: true },
  });
  if (!resolved)
    throw new CodesignError('Image settings are unavailable.', ERROR_CODES.CONFIG_MISSING);
  const signal = AbortSignal.timeout(120_000);
  try {
    const result = await generateImage(
      toGenerateImageOptions(
        resolved,
        'A simple blue circle on a plain white background. No text.',
        signal,
      ),
    );
    return { provider: result.provider, model: result.model, mimeType: result.mimeType };
  } catch (error) {
    if (signal.aborted) {
      throw new CodesignError(
        'Image generation test timed out after 120 seconds.',
        ERROR_CODES.PROVIDER_ABORTED,
      );
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = normalizeProviderError(
      new Error(redactTestCredential(rawMessage, resolved.apiKey)),
      resolved.provider,
      0,
    ).upstream_message;
    throw new CodesignError(
      message,
      error instanceof CodesignError ? error.code : ERROR_CODES.PROVIDER_ERROR,
    );
  }
}
