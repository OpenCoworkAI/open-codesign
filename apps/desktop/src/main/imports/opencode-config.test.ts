import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  opencodeAuthPath,
  opencodeConfigCandidatePaths,
  readOpencodeConfig,
  stripJsonComments,
} from './opencode-config';

async function makeHome(): Promise<string> {
  const home = join(tmpdir(), `open-codesign-opencode-${Date.now()}-${Math.random()}`);
  await mkdir(home, { recursive: true });
  return home;
}

async function writeAuth(home: string, json: unknown): Promise<void> {
  const dir = join(home, '.local', 'share', 'opencode');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'auth.json'), JSON.stringify(json), 'utf8');
}

async function writeConfig(home: string, filename: string, body: string): Promise<void> {
  const dir = join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), body, 'utf8');
}

describe('opencodeAuthPath', () => {
  it('defaults to ~/.local/share/opencode/auth.json on all platforms', () => {
    const home = '/home/alice';
    expect(opencodeAuthPath(home, {})).toBe('/home/alice/.local/share/opencode/auth.json');
  });

  it('honors XDG_DATA_HOME when set', () => {
    const path = opencodeAuthPath('/home/alice', { XDG_DATA_HOME: '/custom/data' });
    expect(path).toBe('/custom/data/opencode/auth.json');
  });

  it('lists jsonc/json/config.json candidates for config', () => {
    const paths = opencodeConfigCandidatePaths('/home/alice', {});
    expect(paths).toEqual([
      '/home/alice/.config/opencode/opencode.jsonc',
      '/home/alice/.config/opencode/opencode.json',
      '/home/alice/.config/opencode/config.json',
    ]);
  });
});

describe('readOpencodeConfig', () => {
  it('returns null when auth.json is absent', async () => {
    const home = await makeHome();
    const out = await readOpencodeConfig(home, {});
    expect(out).toBeNull();
  });

  it('returns an empty import when auth.json is an empty object', async () => {
    const home = await makeHome();
    await writeAuth(home, {});
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.apiKeyMap).toEqual({});
    expect(out?.activeProvider).toBeNull();
    expect(out?.activeModel).toBeNull();
    expect(out?.warnings).toEqual([]);
  });

  it('translates a single anthropic api entry into an opencode-anthropic ProviderEntry', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: 'sk-ant-abc' } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toHaveLength(1);
    const entry = out?.providers[0];
    expect(entry?.id).toBe('opencode-anthropic');
    expect(entry?.name).toBe('OpenCode · Anthropic');
    expect(entry?.wire).toBe('anthropic');
    expect(entry?.baseUrl).toBe('https://api.anthropic.com');
    expect(entry?.defaultModel).toBe('claude-sonnet-4-6');
    expect(out?.apiKeyMap['opencode-anthropic']).toBe('sk-ant-abc');
  });

  it('imports both openai and anthropic when both are present', async () => {
    const home = await makeHome();
    await writeAuth(home, {
      openai: { type: 'api', key: 'sk-openai' },
      anthropic: { type: 'api', key: 'sk-ant' },
    });
    const out = await readOpencodeConfig(home, {});
    const ids = out?.providers.map((p) => p.id).sort();
    expect(ids).toEqual(['opencode-anthropic', 'opencode-openai']);
    expect(out?.apiKeyMap['opencode-openai']).toBe('sk-openai');
    expect(out?.apiKeyMap['opencode-anthropic']).toBe('sk-ant');
  });

  it('maps google to the OpenAI-compatible Gemini endpoint', async () => {
    const home = await makeHome();
    await writeAuth(home, { google: { type: 'api', key: 'AIzaSy-stub' } });
    const out = await readOpencodeConfig(home, {});
    const entry = out?.providers[0];
    expect(entry?.id).toBe('opencode-google');
    expect(entry?.wire).toBe('openai-chat');
    expect(entry?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('maps openrouter with the shared default model', async () => {
    const home = await makeHome();
    await writeAuth(home, { openrouter: { type: 'api', key: 'sk-or' } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers[0]?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(out?.providers[0]?.defaultModel).toMatch(/^anthropic\/claude-sonnet-4/);
  });

  it('skips OAuth entries with a warning', async () => {
    const home = await makeHome();
    await writeAuth(home, {
      anthropic: {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600_000,
      },
    });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/OAuth/i);
  });

  it('skips wellknown entries with a warning', async () => {
    const home = await makeHome();
    await writeAuth(home, {
      github: { type: 'wellknown', key: 'user', token: 'token' },
    });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/well-known|wellknown/i);
  });

  it('skips unknown providers with a warning', async () => {
    const home = await makeHome();
    await writeAuth(home, { weirdai: { type: 'api', key: 'sk-w' } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/weirdai.*isn't supported/);
  });

  it.each([
    ['mistral', 'https://api.mistral.ai/v1', 'Mistral'],
    ['groq', 'https://api.groq.com/openai/v1', 'Groq'],
    ['deepseek', 'https://api.deepseek.com/v1', 'DeepSeek'],
    ['xai', 'https://api.x.ai/v1', 'xAI'],
    ['together', 'https://api.together.xyz/v1', 'Together'],
    ['fireworks', 'https://api.fireworks.ai/inference/v1', 'Fireworks'],
    ['cerebras', 'https://api.cerebras.ai/v1', 'Cerebras'],
    ['vercel-ai-gateway', 'https://gateway.ai.vercel.app/v1', 'Vercel AI Gateway'],
  ])(
    'maps extended provider %s to the correct OpenAI-compatible endpoint',
    async (providerId, baseUrl, label) => {
      const home = await makeHome();
      await writeAuth(home, { [providerId]: { type: 'api', key: 'sk-test' } });
      const out = await readOpencodeConfig(home, {});
      expect(out?.providers).toHaveLength(1);
      expect(out?.providers[0]?.id).toBe(`opencode-${providerId}`);
      expect(out?.providers[0]?.name).toBe(`OpenCode · ${label}`);
      expect(out?.providers[0]?.baseUrl).toBe(baseUrl);
      expect(out?.providers[0]?.wire).toBe('openai-chat');
    },
  );

  it('emits a warning on malformed auth.json and returns no providers', async () => {
    const home = await makeHome();
    const dir = join(home, '.local', 'share', 'opencode');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'auth.json'), '{"anthropic": {type: "api"', 'utf8');
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings[0]).toMatch(/not valid JSON/);
  });

  it('trims quoted keys', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: '  sk-ant-spaced  ' } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.apiKeyMap['opencode-anthropic']).toBe('sk-ant-spaced');
  });

  it('resolves activeProvider and activeModel from opencode.json "model" field', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: 'sk-ant' } });
    await writeConfig(
      home,
      'opencode.json',
      JSON.stringify({ model: 'anthropic/claude-opus-4-1' }),
    );
    const out = await readOpencodeConfig(home, {});
    expect(out?.activeProvider).toBe('opencode-anthropic');
    expect(out?.activeModel).toBe('claude-opus-4-1');
    // Default model is rewritten to the user's active selection so the UI
    // surfaces the pick they're already using.
    expect(out?.providers[0]?.defaultModel).toBe('claude-opus-4-1');
  });

  it('ignores active-model hints pointing at providers we did not import', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: 'sk-ant' } });
    await writeConfig(home, 'config.json', JSON.stringify({ model: 'mistral/large' }));
    const out = await readOpencodeConfig(home, {});
    expect(out?.activeProvider).toBeNull();
    expect(out?.activeModel).toBeNull();
  });

  it('parses opencode.jsonc with line comments', async () => {
    const home = await makeHome();
    await writeAuth(home, { openai: { type: 'api', key: 'sk-oa' } });
    await writeConfig(
      home,
      'opencode.jsonc',
      '// active model\n{\n  "model": "openai/gpt-5" /* block */\n}\n',
    );
    const out = await readOpencodeConfig(home, {});
    expect(out?.activeProvider).toBe('opencode-openai');
    expect(out?.activeModel).toBe('gpt-5');
  });

  it('honors XDG_DATA_HOME for auth.json lookup', async () => {
    const home = await makeHome();
    const xdgData = join(home, 'xdg-data');
    await mkdir(join(xdgData, 'opencode'), { recursive: true });
    await writeFile(
      join(xdgData, 'opencode', 'auth.json'),
      JSON.stringify({ openai: { type: 'api', key: 'sk-xdg' } }),
      'utf8',
    );
    const out = await readOpencodeConfig(home, { XDG_DATA_HOME: xdgData });
    expect(out?.apiKeyMap['opencode-openai']).toBe('sk-xdg');
  });

  it('sets envKey per provider so the runtime env-fallback can rescue the row', async () => {
    const home = await makeHome();
    await writeAuth(home, {
      anthropic: { type: 'api', key: 'sk-ant' },
      openai: { type: 'api', key: 'sk-oa' },
      google: { type: 'api', key: 'AIzaSy-g' },
    });
    const out = await readOpencodeConfig(home, {});
    const envKeyById = Object.fromEntries(out?.providers.map((p) => [p.id, p.envKey]) ?? []);
    expect(envKeyById['opencode-anthropic']).toBe('ANTHROPIC_API_KEY');
    expect(envKeyById['opencode-openai']).toBe('OPENAI_API_KEY');
    expect(envKeyById['opencode-google']).toBe('GEMINI_API_KEY');
  });

  it('warns with the actual unknown type string instead of a generic "unknown"', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'cli-auth-v2', key: 'sk-future' } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/cli-auth-v2/);
  });

  it.each([
    ['array top-level', '[{}]'],
    ['number top-level', '42'],
    ['string top-level', '"hello"'],
  ])('surfaces a warning for %s in auth.json', async (_label, body) => {
    const home = await makeHome();
    const dir = join(home, '.local', 'share', 'opencode');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'auth.json'), body, 'utf8');
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings[0]).toMatch(/unexpected top-level shape|not valid JSON/);
  });

  it('skips provider entries that are strings instead of objects', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: 'sk-ant-literal-string' as unknown });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/invalid entry shape/);
  });

  it('skips api entries whose key is a number rather than a string', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: 12345 } });
    const out = await readOpencodeConfig(home, {});
    expect(out?.providers).toEqual([]);
    expect(out?.warnings.join('\n')).toMatch(/no API key/);
  });

  it.each([
    [
      'openrouter/anthropic/claude-sonnet-4.6',
      'opencode-openrouter',
      'anthropic/claude-sonnet-4.6',
    ],
  ])(
    'treats the first slash as provider/model boundary for nested-path model %s',
    async (modelString, expectedProvider, expectedModel) => {
      const home = await makeHome();
      await writeAuth(home, { openrouter: { type: 'api', key: 'sk-or' } });
      await writeConfig(home, 'opencode.json', JSON.stringify({ model: modelString }));
      const out = await readOpencodeConfig(home, {});
      expect(out?.activeProvider).toBe(expectedProvider);
      expect(out?.activeModel).toBe(expectedModel);
    },
  );

  it.each([['/leading'], ['trailing/'], ['no-slash-at-all']])(
    'ignores malformed active-model string "%s"',
    async (modelString) => {
      const home = await makeHome();
      await writeAuth(home, { anthropic: { type: 'api', key: 'sk-ant' } });
      await writeConfig(home, 'opencode.json', JSON.stringify({ model: modelString }));
      const out = await readOpencodeConfig(home, {});
      expect(out?.activeProvider).toBeNull();
      expect(out?.activeModel).toBeNull();
    },
  );

  it('surfaces a warning when opencode.jsonc has a parse error', async () => {
    const home = await makeHome();
    await writeAuth(home, { anthropic: { type: 'api', key: 'sk-ant' } });
    await writeConfig(home, 'opencode.jsonc', '// comment\n{"model": "anthropic/x",}'); // trailing comma
    const out = await readOpencodeConfig(home, {});
    expect(out?.warnings.some((w) => /Could not parse/.test(w))).toBe(true);
  });
});

describe('stripJsonComments', () => {
  it('strips a trailing // line comment', () => {
    expect(stripJsonComments('{"a": 1} // note')).toBe('{"a": 1} ');
  });

  it('strips a /* block */ comment', () => {
    expect(stripJsonComments('{/*drop*/"a": 1}')).toBe('{"a": 1}');
  });

  it('preserves // inside strings (URLs)', () => {
    expect(stripJsonComments('{"url": "https://example.com/path"}')).toBe(
      '{"url": "https://example.com/path"}',
    );
  });

  it('preserves /* inside strings', () => {
    expect(stripJsonComments('{"x": "a /* not-a-comment */ b"}')).toBe(
      '{"x": "a /* not-a-comment */ b"}',
    );
  });

  it('handles escaped quotes inside strings', () => {
    expect(stripJsonComments('{"x": "a\\"b"} // tail')).toBe('{"x": "a\\"b"} ');
  });

  it('stays safe on an unterminated block comment', () => {
    expect(stripJsonComments('before /* never closes')).toBe('before ');
  });
});
