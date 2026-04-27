import { ERROR_CODES } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultImageModel, generateImage } from './images';

const PNG_HEADER_BASE64 = 'iVBORw0KGgo=';
const WEBP_HEADER_BASE64 = 'UklGRgAAAABXRUJQ';

describe('generateImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls OpenAI image generations and normalizes b64_json', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ b64_json: PNG_HEADER_BASE64, revised_prompt: 'A clean hero image' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({
      provider: 'openai',
      apiKey: 'sk-test',
      prompt: 'hero image',
      model: 'gpt-image-2',
      size: '1536x1024',
      quality: 'high',
      outputFormat: 'png',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: 'hero image',
          n: 1,
          size: '1536x1024',
          quality: 'high',
          output_format: 'png',
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_HEADER_BASE64}`,
      revisedPrompt: 'A clean hero image',
    });
  });

  it('calls OpenRouter chat completions with image modalities', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [
                  {
                    type: 'image_url',
                    image_url: { url: `\n data:image/webp;base64,${WEBP_HEADER_BASE64} \n` },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      prompt: 'poster',
      aspectRatio: '16:9',
      outputFormat: 'webp',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: defaultImageModel('openrouter'),
          messages: [{ role: 'user', content: 'poster' }],
          modalities: ['image', 'text'],
          stream: false,
          image_config: {
            aspect_ratio: '16:9',
            output_format: 'webp',
          },
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'openrouter',
      model: defaultImageModel('openrouter'),
      mimeType: 'image/webp',
      base64: WEBP_HEADER_BASE64,
    });
  });

  it('rejects missing API keys before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateImage({ provider: 'openai', apiKey: '', prompt: 'hero image' }),
    ).rejects.toThrow(/Missing image generation API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps non-JSON image responses in a typed provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );

    await expect(
      generateImage({ provider: 'openai', apiKey: 'sk-test', prompt: 'hero image' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('not valid JSON'),
    });
  });

  it('rejects malformed OpenAI base64 image data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ data: [{ b64_json: '%%%%' }] }), { status: 200 }),
      ),
    );

    await expect(
      generateImage({ provider: 'openai', apiKey: 'sk-test', prompt: 'hero image' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('malformed base64'),
    });
  });

  it('rejects image data that does not match its MIME type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] }), { status: 200 }),
      ),
    );

    await expect(
      generateImage({ provider: 'openai', apiKey: 'sk-test', prompt: 'hero image' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('did not match image/png'),
    });
  });

  it('rejects malformed OpenRouter data URL image data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    images: [{ image_url: { url: 'data:image/png;base64,%%%%' } }],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      generateImage({ provider: 'openrouter', apiKey: 'sk-or-test', prompt: 'poster' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('malformed'),
    });
  });

  it('rejects unsupported generated image MIME types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    images: [{ image_url: { url: 'data:image/svg+xml;base64,PHN2Zy8+' } }],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    await expect(
      generateImage({ provider: 'openrouter', apiKey: 'sk-or-test', prompt: 'poster' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('unsupported image MIME type'),
    });
  });
});
