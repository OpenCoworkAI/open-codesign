import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GEMINI_API_KEY_PATTERN,
  GEMINI_DEFAULT_MODEL,
  GEMINI_OPENAI_COMPAT_BASE_URL,
  type GeminiImport,
  parseDotEnv,
  parseDotEnvLines,
  readGeminiCliConfig,
} from './gemini-cli-config';

const VALID_KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';
const ANOTHER_KEY = `AIzaSy${'0'.repeat(33)}`;

/** Narrow a result to the `found` arm, throwing if it's null or `blocked`.
 *  Keeps individual tests terse — `const f = expectFound(out); f.apiKey`. */
function expectFound(out: GeminiImport | null): Extract<GeminiImport, { kind: 'found' }> {
  if (out === null || out.kind !== 'found') {
    throw new Error(`expected found, got ${out === null ? 'null' : out.kind}`);
  }
  return out;
}

function expectBlocked(out: GeminiImport | null): Extract<GeminiImport, { kind: 'blocked' }> {
  if (out === null || out.kind !== 'blocked') {
    throw new Error(`expected blocked, got ${out === null ? 'null' : out.kind}`);
  }
  return out;
}

async function makeHome(): Promise<string> {
  const home = join(tmpdir(), `open-codesign-gemini-${Date.now()}-${Math.random()}`);
  await mkdir(home, { recursive: true });
  return home;
}

describe('parseDotEnv', () => {
  it('parses simple KEY=value lines', () => {
    expect(parseDotEnv('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips surrounding double and single quotes', () => {
    expect(parseDotEnv('A="x"\nB=\'y\'')).toEqual({ A: 'x', B: 'y' });
  });

  it('ignores comments and blank lines', () => {
    const content = `
# top comment

FOO=bar
# inline-ish comment

BAZ=qux
`;
    expect(parseDotEnv(content)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('accepts optional export prefix', () => {
    expect(parseDotEnv('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('trims whitespace around key and value', () => {
    expect(parseDotEnv('  FOO  =   bar  ')).toEqual({ FOO: 'bar' });
  });

  it('ignores lines without an equals sign or with empty key', () => {
    expect(parseDotEnv('NOTANENV\n=VALUE_ONLY\nOK=v')).toEqual({ OK: 'v' });
  });

  it('rejects keys with invalid identifier characters', () => {
    expect(parseDotEnv('BAD-KEY=v\nOK=v')).toEqual({ OK: 'v' });
  });

  it('preserves = inside values', () => {
    expect(parseDotEnv('A=foo=bar=baz')).toEqual({ A: 'foo=bar=baz' });
  });
});

describe('parseDotEnvLines', () => {
  it('returns skipped lines for non-KEY=VALUE content', () => {
    const r = parseDotEnvLines('OK=v\nBAD LINE WITHOUT EQUALS\n# comment\n\nOK2=v2');
    expect(r.vars).toEqual({ OK: 'v', OK2: 'v2' });
    expect(r.skipped).toEqual(['BAD LINE WITHOUT EQUALS']);
  });

  it('skips keys with invalid identifier characters', () => {
    const r = parseDotEnvLines('BAD-KEY=v\nOK=v');
    expect(r.skipped).toEqual(['BAD-KEY=v']);
  });
});

describe('readGeminiCliConfig', () => {
  it('returns null when no .env files exist and shell has no GEMINI_API_KEY', async () => {
    const home = await makeHome();
    const out = await readGeminiCliConfig(home, { env: {} });
    expect(out).toBeNull();
  });

  it('reads the key from ~/.gemini/.env', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe(VALID_KEY);
    expect(out.apiKeySource).toBe('gemini-env');
    expect(out.keyPath).toBe(join(home, '.gemini', '.env'));
    expect(out.provider.id).toBe('gemini-import');
    expect(out.provider.wire).toBe('openai-chat');
    expect(out.provider.baseUrl).toBe(GEMINI_OPENAI_COMPAT_BASE_URL);
    expect(out.provider.defaultModel).toBe(GEMINI_DEFAULT_MODEL);
    expect(out.provider.envKey).toBe('GEMINI_API_KEY');
    expect(out.warnings).toEqual([]);
  });

  it('falls back to ~/.env when ~/.gemini/.env has no GEMINI_API_KEY', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), 'SOMETHING_ELSE=value\n', 'utf8');
    await writeFile(join(home, '.env'), `GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe(VALID_KEY);
    expect(out.apiKeySource).toBe('home-env');
    expect(out.keyPath).toBe(join(home, '.env'));
  });

  it('prefers ~/.gemini/.env over ~/.env when both define GEMINI_API_KEY', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
    await writeFile(join(home, '.env'), `GEMINI_API_KEY=${ANOTHER_KEY}\n`, 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe(VALID_KEY);
    expect(out.apiKeySource).toBe('gemini-env');
  });

  it('falls back to shell env GEMINI_API_KEY when no file has it', async () => {
    const home = await makeHome();
    const out = expectFound(
      await readGeminiCliConfig(home, { env: { GEMINI_API_KEY: VALID_KEY } }),
    );
    expect(out.apiKey).toBe(VALID_KEY);
    expect(out.apiKeySource).toBe('shell-env');
    expect(out.keyPath).toBeNull();
  });

  it('files outrank the shell env', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
    const out = expectFound(
      await readGeminiCliConfig(home, { env: { GEMINI_API_KEY: ANOTHER_KEY } }),
    );
    expect(out.apiKey).toBe(VALID_KEY);
    expect(out.apiKeySource).toBe('gemini-env');
  });

  it('strips surrounding quotes around the stored value', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY="${VALID_KEY}"\n`, 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe(VALID_KEY);
  });

  it('warns when the key does not match the AIzaSy pattern but still imports it', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), 'GEMINI_API_KEY=malformed-key\n', 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe('malformed-key');
    expect(out.warnings.join('\n')).toMatch(/AIzaSy/);
    // Provider is still populated so the user can correct the key in Settings
    // without losing the import flow.
    expect(out.provider).not.toBeNull();
  });

  it('refuses to import a Vertex AI setup', async () => {
    const home = await makeHome();
    const out = expectBlocked(
      await readGeminiCliConfig(home, { env: { GOOGLE_GENAI_USE_VERTEXAI: 'true' } }),
    );
    expect(out.warnings.join('\n')).toMatch(/Vertex/);
  });

  it.each(['TRUE', 'True', '1', 'yes', 'YES', 'On', ' on '])(
    'treats GOOGLE_GENAI_USE_VERTEXAI=%s as Vertex (case-insensitive + trimmed)',
    async (value) => {
      const home = await makeHome();
      const out = expectBlocked(
        await readGeminiCliConfig(home, { env: { GOOGLE_GENAI_USE_VERTEXAI: value } }),
      );
      expect(out.warnings.join('\n')).toMatch(/Vertex/);
    },
  );

  it.each(['false', 'FALSE', '0', 'no', ''])(
    'ignores GOOGLE_GENAI_USE_VERTEXAI=%s as not-Vertex',
    async (value) => {
      const home = await makeHome();
      await mkdir(join(home, '.gemini'), { recursive: true });
      await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
      const out = expectFound(
        await readGeminiCliConfig(home, { env: { GOOGLE_GENAI_USE_VERTEXAI: value } }),
      );
      expect(out.apiKey).toBe(VALID_KEY);
    },
  );

  it('accepts export-prefixed lines', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), `export GEMINI_API_KEY=${VALID_KEY}\n`, 'utf8');
    const out = expectFound(await readGeminiCliConfig(home, { env: {} }));
    expect(out.apiKey).toBe(VALID_KEY);
  });

  it('warns when ~/.gemini/.env has a GEMINI_API_KEY line missing `=`', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    // Space instead of `=` — the user's intent is clearly to declare the
    // key but the syntax is wrong. Silently dropping this line lets the
    // user conclude "the import doesn't work" with zero diagnostic.
    await writeFile(join(home, '.gemini', '.env'), `GEMINI_API_KEY ${VALID_KEY}\n`, 'utf8');
    const out = expectBlocked(await readGeminiCliConfig(home, { env: {} }));
    expect(out.warnings.join('\n')).toMatch(/GEMINI_API_KEY.*missing.*=/);
  });

  it('surfaces the missing-equals warning even when the key comes from shell env', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.gemini'), { recursive: true });
    await writeFile(join(home, '.gemini', '.env'), 'GEMINI_API_KEY AIzaSy-bad\n', 'utf8');
    const out = await readGeminiCliConfig(home, { env: { GEMINI_API_KEY: VALID_KEY } });
    // The shell key wins, but the file warning must still ride along so
    // the user notices their broken .env line.
    expect(out?.kind).toBe('found');
    if (out?.kind === 'found') {
      expect(out.apiKey).toBe(VALID_KEY);
      expect(out.warnings.join('\n')).toMatch(/GEMINI_API_KEY.*missing.*=/);
    }
  });
});

describe('GEMINI_API_KEY_PATTERN', () => {
  it('matches canonical keys', () => {
    expect(GEMINI_API_KEY_PATTERN.test(VALID_KEY)).toBe(true);
    expect(GEMINI_API_KEY_PATTERN.test(ANOTHER_KEY)).toBe(true);
  });

  it('rejects non-Google keys', () => {
    expect(GEMINI_API_KEY_PATTERN.test('sk-ant-1234')).toBe(false);
    expect(GEMINI_API_KEY_PATTERN.test(`AIzaSy${'x'.repeat(32)}`)).toBe(false);
    expect(GEMINI_API_KEY_PATTERN.test(`AIzaSy${'x'.repeat(34)}`)).toBe(false);
  });
});
