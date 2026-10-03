import { once } from 'node:events';
import { createServer } from 'node:http';
import { ERROR_CODES } from '@open-codesign/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultImageModel, generateImage } from './images';

const PNG_HEADER_BASE64 = 'iVBORw0KGgo=';
const WEBP_HEADER_BASE64 = 'UklGRgAAAABXRUJQ';

function jwtWithClaims(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'sig',
  ].join('.');
}

describe('generateImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    true,
    false,
    undefined,
  ])('honors the explicit base64 request option (%s) at custom endpoints', async (requestBase64) => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (req, res) => {
      if (req.url !== '/v1/images/generations' && req.url !== '/strict/v1/images/generations') {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      requests.push(body);
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/strict/') && 'response_format' in body) {
        res
          .writeHead(400)
          .end(JSON.stringify({ error: { message: 'Unknown parameter: response_format' } }));
        return;
      }
      res.end(
        JSON.stringify({
          data: [
            req.url.startsWith('/strict/') || body['response_format'] === 'b64_json'
              ? { b64_json: PNG_HEADER_BASE64 }
              : { url: '/generated/image.png' },
          ],
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing server port');
    const path = requestBase64 === true ? 'v1' : 'strict/v1';
    const baseUrl = `http://127.0.0.1:${address.port}/${path}/`;
    try {
      const result = await generateImage({
        provider: 'openai',
        apiKey: 'local-test-only',
        prompt: 'hero image',
        baseUrl,
        requestBase64,
      });
      expect(result.base64).toBe(PNG_HEADER_BASE64);
      expect(requests).toHaveLength(1);
      if (requestBase64 === true) {
        expect(requests[0]).toHaveProperty('response_format', 'b64_json');
      } else {
        expect(requests[0]).not.toHaveProperty('response_format');
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it.each([
    'https://api.openai.com/v1',
    'https://api.openai.com/v1/',
    'https://API.OPENAI.COM:443/v1/',
  ])('preserves GPT image request compatibility at the official endpoint %s', async (baseUrl) => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: PNG_HEADER_BASE64 }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await generateImage({ provider: 'openai', apiKey: 'test', prompt: 'hero image', baseUrl });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).not.toHaveProperty('response_format');
  });

  it('reports invalid custom endpoints as typed provider errors', async () => {
    await expect(
      generateImage({
        provider: 'openai',
        apiKey: 'local-test-only',
        prompt: 'hero image',
        baseUrl: 'invalid-url',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PROVIDER_ERROR });
  });

  it('surfaces a rejected base64 option without automatically repeating generation', async () => {
    const fetchMock = vi.fn(
      async () => new Response('Unknown parameter: response_format', { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      generateImage({
        provider: 'openai',
        apiKey: 'local-test-only',
        prompt: 'fixture',
        requestBase64: true,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_ERROR,
      message: expect.stringContaining('HTTP 400'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      requestBase64: true,
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

  it('calls ChatGPT Codex responses with OAuth headers and extracts streamed image data', async () => {
    const token = jwtWithClaims({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_test' },
      email: 'person@example.com',
    });
    const fetchMock = vi.fn(async () => {
      return new Response(
        [
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"iVBORw0KGgo=","revised_prompt":"A tabby cat with an otter"}}',
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage({
      provider: 'chatgpt-codex',
      apiKey: token,
      requestBase64: true,
      prompt: 'draw a cat hugging an otter',
      size: '1024x1024',
      quality: 'high',
      outputFormat: 'png',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${token}`,
          'chatgpt-account-id': 'acct_test',
          accept: 'text/event-stream',
          'openai-beta': 'responses=experimental',
        }),
        body: JSON.stringify({
          model: 'gpt-5.5',
          store: false,
          stream: true,
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'draw a cat hugging an otter' }],
            },
          ],
          tools: [
            {
              type: 'image_generation',
              size: '1024x1024',
              quality: 'high',
              output_format: 'png',
            },
          ],
          tool_choice: { type: 'image_generation' },
        }),
      }),
    );
    expect(result).toMatchObject({
      provider: 'chatgpt-codex',
      model: 'gpt-5.5',
      mimeType: 'image/png',
      base64: PNG_HEADER_BASE64,
      revisedPrompt: 'A tabby cat with an otter',
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
