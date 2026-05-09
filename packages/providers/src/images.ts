import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export type ImageGenerationProvider = 'openai' | 'openrouter' | 'chatgpt-codex';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export type ImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536';
export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface GenerateImageOptions {
  provider: ImageGenerationProvider;
  apiKey: string;
  prompt: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  size?: ImageSize | undefined;
  aspectRatio?: ImageAspectRatio | undefined;
  quality?: ImageQuality | undefined;
  outputFormat?: ImageOutputFormat | undefined;
  background?: 'auto' | 'transparent' | 'opaque' | undefined;
  signal?: AbortSignal | undefined;
  httpHeaders?: Record<string, string> | undefined;
}

export interface GenerateImageResult {
  dataUrl: string;
  mimeType: string;
  base64: string;
  model: string;
  provider: ImageGenerationProvider;
  revisedPrompt?: string | undefined;
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: unknown;
    url?: unknown;
    revised_prompt?: unknown;
  }>;
}

interface OpenRouterImageResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      images?: Array<{
        type?: unknown;
        image_url?: {
          url?: unknown;
        };
        imageUrl?: {
          url?: unknown;
        };
      }>;
    };
  }>;
}

interface ChatGPTCodexImageEvent {
  type?: unknown;
  code?: unknown;
  message?: unknown;
  item?: unknown;
  response?: unknown;
}

interface ImageGenerationCallItem {
  type?: unknown;
  result?: unknown;
  revised_prompt?: unknown;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_OPENROUTER_IMAGE_MODEL = 'openai/gpt-5.4-image-2';
const DEFAULT_CHATGPT_CODEX_IMAGE_MODEL = 'gpt-5.5';
const BASE64_IMAGE_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function defaultImageModel(provider: ImageGenerationProvider): string {
  if (provider === 'openrouter') return DEFAULT_OPENROUTER_IMAGE_MODEL;
  if (provider === 'chatgpt-codex') return DEFAULT_CHATGPT_CODEX_IMAGE_MODEL;
  return DEFAULT_OPENAI_IMAGE_MODEL;
}

export function defaultImageBaseUrl(provider: ImageGenerationProvider): string {
  if (provider === 'openrouter') return DEFAULT_OPENROUTER_BASE_URL;
  if (provider === 'chatgpt-codex') return DEFAULT_CHATGPT_CODEX_BASE_URL;
  return DEFAULT_OPENAI_BASE_URL;
}

export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!options.apiKey.trim()) {
    throw new CodesignError('Missing image generation API key', ERROR_CODES.PROVIDER_AUTH_MISSING);
  }
  const prompt = options.prompt.trim();
  if (prompt.length === 0) {
    throw new CodesignError('Image prompt cannot be empty', ERROR_CODES.INPUT_EMPTY_PROMPT);
  }
  if (options.provider === 'openrouter') return generateOpenRouterImage({ ...options, prompt });
  if (options.provider === 'chatgpt-codex') {
    return generateChatGPTCodexImage({ ...options, prompt });
  }
  return generateOpenAIImage({ ...options, prompt });
}

async function generateOpenAIImage(
  options: GenerateImageOptions & { prompt: string },
): Promise<GenerateImageResult> {
  const model = options.model?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  const body: Record<string, unknown> = {
    model,
    prompt: options.prompt,
    n: 1,
  };
  if (options.size !== undefined) body['size'] = options.size;
  if (options.quality !== undefined) body['quality'] = options.quality;
  if (options.outputFormat !== undefined) body['output_format'] = options.outputFormat;
  if (options.background !== undefined) body['background'] = options.background;

  const json = await postJson<OpenAIImageResponse>(
    joinEndpoint(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL, 'images/generations'),
    body,
    options,
  );
  const first = json.data?.[0];
  if (first === undefined) {
    throw new CodesignError(
      'OpenAI image response did not include data',
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  const revisedPrompt =
    typeof first.revised_prompt === 'string' && first.revised_prompt.length > 0
      ? first.revised_prompt
      : undefined;
  if (typeof first.b64_json === 'string' && first.b64_json.length > 0) {
    const mimeType = mimeFromFormat(options.outputFormat ?? 'png');
    const base64 = normalizeBase64ImageData(first.b64_json, 'OpenAI image response');
    validateImageSignature(mimeType, base64, 'OpenAI image response');
    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      base64,
      mimeType,
      model,
      provider: 'openai',
      ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
    };
  }
  if (typeof first.url === 'string' && first.url.trim().startsWith('data:')) {
    return {
      ...parseDataUrl(first.url),
      model,
      provider: 'openai',
      ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
    };
  }
  throw new CodesignError(
    'OpenAI image response did not include base64 image data',
    ERROR_CODES.PROVIDER_ERROR,
  );
}

async function generateOpenRouterImage(
  options: GenerateImageOptions & { prompt: string },
): Promise<GenerateImageResult> {
  const model = options.model?.trim() || DEFAULT_OPENROUTER_IMAGE_MODEL;
  const imageConfig: Record<string, unknown> = {};
  if (options.aspectRatio !== undefined) imageConfig['aspect_ratio'] = options.aspectRatio;
  if (options.quality !== undefined && options.quality !== 'auto')
    imageConfig['quality'] = options.quality;
  if (options.outputFormat !== undefined) imageConfig['output_format'] = options.outputFormat;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: options.prompt }],
    modalities: ['image', 'text'],
    stream: false,
  };
  if (Object.keys(imageConfig).length > 0) body['image_config'] = imageConfig;

  const json = await postJson<OpenRouterImageResponse>(
    joinEndpoint(options.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL, 'chat/completions'),
    body,
    options,
  );
  const message = json.choices?.[0]?.message;
  const image = message?.images?.[0];
  const url = image?.image_url?.url ?? image?.imageUrl?.url;
  if (typeof url === 'string' && url.trim().startsWith('data:')) {
    return {
      ...parseDataUrl(url),
      model,
      provider: 'openrouter',
    };
  }
  throw new CodesignError(
    'OpenRouter image response did not include generated image data',
    ERROR_CODES.PROVIDER_ERROR,
  );
}

async function generateChatGPTCodexImage(
  options: GenerateImageOptions & { prompt: string },
): Promise<GenerateImageResult> {
  const model = options.model?.trim() || DEFAULT_CHATGPT_CODEX_IMAGE_MODEL;
  const imageTool: Record<string, unknown> = {
    type: 'image_generation',
  };
  if (options.size !== undefined) imageTool['size'] = options.size;
  if (options.quality !== undefined) imageTool['quality'] = options.quality;
  if (options.outputFormat !== undefined) imageTool['output_format'] = options.outputFormat;
  if (options.background !== undefined) imageTool['background'] = options.background;

  const body: Record<string, unknown> = {
    model,
    store: false,
    stream: true,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: options.prompt }],
      },
    ],
    tools: [imageTool],
    tool_choice: { type: 'image_generation' },
  };

  const { base64, revisedPrompt } = await postChatGPTCodexImageStream(
    resolveCodexResponsesEndpoint(options.baseUrl ?? DEFAULT_CHATGPT_CODEX_BASE_URL),
    body,
    options,
  );
  const mimeType = mimeFromFormat(options.outputFormat ?? 'png');
  const normalized = normalizeBase64ImageData(base64, 'ChatGPT image response');
  validateImageSignature(mimeType, normalized, 'ChatGPT image response');
  return {
    dataUrl: `data:${mimeType};base64,${normalized}`,
    base64: normalized,
    mimeType,
    model,
    provider: 'chatgpt-codex',
    ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
  };
}

async function postChatGPTCodexImageStream(
  url: string,
  body: Record<string, unknown>,
  options: GenerateImageOptions,
): Promise<{ base64: string; revisedPrompt?: string | undefined }> {
  let res: Response;
  const accountId = extractChatGPTAccountId(options.apiKey);
  try {
    res = await fetch(url, {
      method: 'POST',
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'chatgpt-account-id': accountId,
        originator: 'open-codesign',
        'openai-beta': 'responses=experimental',
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(options.httpHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Image generation request failed: ${message}`,
      ERROR_CODES.PROVIDER_ERROR,
      {
        cause: err,
      },
    );
  }
  if (!res.ok) {
    const text = await safeResponseText(res);
    throw new CodesignError(
      `Image generation failed with HTTP ${res.status}${text.length > 0 ? `: ${text}` : ''}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  const text = await safeResponseText(res, Number.POSITIVE_INFINITY);
  const parsed = parseChatGPTCodexImageStream(text);
  if (parsed !== null) return parsed;

  try {
    const json = JSON.parse(text) as unknown;
    const item = findImageGenerationCall(json);
    if (item !== null) return item;
  } catch {
    // Keep the provider-facing error below focused on the missing image result.
  }
  throw new CodesignError(
    'ChatGPT image response did not include generated image data',
    ERROR_CODES.PROVIDER_ERROR,
  );
}

function parseChatGPTCodexImageStream(
  text: string,
): { base64: string; revisedPrompt?: string | undefined } | null {
  let found: { base64: string; revisedPrompt?: string | undefined } | null = null;
  const chunks = text.split(/\r?\n\r?\n/);
  for (const chunk of chunks) {
    const data = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();
    if (data.length === 0 || data === '[DONE]') continue;
    let event: ChatGPTCodexImageEvent;
    try {
      event = JSON.parse(data) as ChatGPTCodexImageEvent;
    } catch {
      continue;
    }
    if (event.type === 'error') {
      const message = typeof event.message === 'string' ? event.message : JSON.stringify(event);
      throw new CodesignError(
        `ChatGPT image generation failed: ${message}`,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
    if (event.type === 'response.failed') {
      const message = responseErrorMessage(event.response) ?? 'ChatGPT image generation failed';
      throw new CodesignError(message, ERROR_CODES.PROVIDER_ERROR);
    }
    const item =
      event.type === 'response.output_item.done' ? readImageGenerationCall(event.item) : null;
    if (item !== null) found = item;
    const responseItem =
      event.type === 'response.completed' || event.type === 'response.done'
        ? findImageGenerationCall(event.response)
        : null;
    if (responseItem !== null) found = responseItem;
  }
  return found;
}

function findImageGenerationCall(
  value: unknown,
): { base64: string; revisedPrompt?: string | undefined } | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const direct = readImageGenerationCall(record);
  if (direct !== null) return direct;
  const output = record['output'];
  if (Array.isArray(output)) {
    for (const item of output) {
      const parsed = readImageGenerationCall(item);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function readImageGenerationCall(
  value: unknown,
): { base64: string; revisedPrompt?: string | undefined } | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as ImageGenerationCallItem;
  if (item.type !== 'image_generation_call') return null;
  if (typeof item.result !== 'string' || item.result.length === 0) return null;
  const revisedPrompt =
    typeof item.revised_prompt === 'string' && item.revised_prompt.length > 0
      ? item.revised_prompt
      : undefined;
  return { base64: item.result, ...(revisedPrompt !== undefined ? { revisedPrompt } : {}) };
}

function responseErrorMessage(response: unknown): string | null {
  if (response === null || typeof response !== 'object') return null;
  const error = (response as Record<string, unknown>)['error'];
  if (error === null || typeof error !== 'object') return null;
  const message = (error as Record<string, unknown>)['message'];
  return typeof message === 'string' && message.length > 0 ? message : null;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  options: GenerateImageOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(options.httpHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Image generation request failed: ${message}`,
      ERROR_CODES.PROVIDER_ERROR,
      {
        cause: err,
      },
    );
  }
  if (!res.ok) {
    const text = await safeResponseText(res);
    throw new CodesignError(
      `Image generation failed with HTTP ${res.status}${text.length > 0 ? `: ${text}` : ''}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CodesignError(
      `Image generation response was not valid JSON: ${message}`,
      ERROR_CODES.PROVIDER_ERROR,
      { cause: err },
    );
  }
}

function joinEndpoint(baseUrl: string, path: string): string {
  // Trim trailing `/` on baseUrl and leading `/` on path with explicit loops
  // instead of /\/+$/ + /^\/+/. CodeQL flags the anchored-quantifier regex
  // form as polynomial ReDoS on library input, and a simple scan is both
  // linear in the worst case and easier to reason about.
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end--;
  let start = 0;
  while (start < path.length && path.charCodeAt(start) === 47) start++;
  return `${baseUrl.slice(0, end)}/${path.slice(start)}`;
}

function resolveCodexResponsesEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47) end--;
  const normalized = trimmed.slice(0, end);
  if (normalized.endsWith('/codex/responses')) return normalized;
  if (normalized.endsWith('/codex')) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

function extractChatGPTAccountId(token: string): string {
  const claims = decodeJwtClaims(token);
  const topLevel = readNonEmptyString(claims?.['chatgpt_account_id']);
  if (topLevel !== null) return topLevel;
  const nested = claims?.['https://api.openai.com/auth'];
  if (nested !== null && typeof nested === 'object') {
    const accountId = readNonEmptyString(
      (nested as { chatgpt_account_id?: unknown }).chatgpt_account_id,
    );
    if (accountId !== null) return accountId;
  }
  const organizations = claims?.['organizations'];
  if (Array.isArray(organizations)) {
    for (const org of organizations) {
      if (org !== null && typeof org === 'object') {
        const id = readNonEmptyString((org as { id?: unknown }).id);
        if (id !== null) return id;
      }
    }
  }
  throw new CodesignError(
    'ChatGPT OAuth token does not include an account id',
    ERROR_CODES.CODEX_TOKEN_PARSE_FAILED,
  );
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    const payload = parts[1];
    if (parts.length < 2 || payload === undefined || payload.length === 0) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mimeFromFormat(format: ImageOutputFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function parseDataUrl(dataUrl: string): { dataUrl: string; mimeType: string; base64: string } {
  const trimmedDataUrl = dataUrl.trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(trimmedDataUrl);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new CodesignError('Generated image data URL is malformed', ERROR_CODES.PROVIDER_ERROR);
  }
  const base64 = normalizeBase64ImageData(match[2], 'Generated image data URL');
  validateImageSignature(match[1], base64, 'Generated image data URL');
  return { dataUrl: `data:${match[1]};base64,${base64}`, mimeType: match[1], base64 };
}

function normalizeBase64ImageData(base64: string, source: string): string {
  const trimmed = base64.trim();
  if (trimmed.length === 0 || trimmed.length % 4 === 1 || !BASE64_IMAGE_RE.test(trimmed)) {
    throw new CodesignError(
      `${source} included malformed base64 image data`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  return trimmed;
}

function validateImageSignature(mimeType: string, base64: string, source: string): void {
  const normalizedMime = mimeType.toLowerCase();
  if (!normalizedMime.startsWith('image/')) {
    throw new CodesignError(`${source} was not an image MIME type`, ERROR_CODES.PROVIDER_ERROR);
  }
  if (
    normalizedMime !== 'image/png' &&
    normalizedMime !== 'image/jpeg' &&
    normalizedMime !== 'image/jpg' &&
    normalizedMime !== 'image/webp'
  ) {
    throw new CodesignError(
      `${source} used unsupported image MIME type ${normalizedMime}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
  const bytes = Buffer.from(base64, 'base64');
  const valid =
    normalizedMime === 'image/png'
      ? bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      : normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : normalizedMime === 'image/webp'
          ? bytes.length >= 12 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          : false;
  if (!valid) {
    throw new CodesignError(
      `${source} bytes did not match ${normalizedMime}`,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
}

async function safeResponseText(res: Response, limit = 500): Promise<string> {
  try {
    const text = await res.text();
    return Number.isFinite(limit) ? text.slice(0, limit) : text;
  } catch (err) {
    void err;
    // The non-2xx HTTP status is already the failure; the body is diagnostic.
    return '';
  }
}
