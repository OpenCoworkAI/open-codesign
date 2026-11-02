import { describe, expect, it } from 'vitest';
import { parseArguments } from './arguments';
import { modelSetupError } from './ui-debug';

describe('background model CLI contract', () => {
  it('keeps model access off by default and forwards explicit fixture/live selection', () => {
    const args = ['debug', 'session', '--output', 'new-dir'];
    expect(parseArguments(args).modelMode).toBeUndefined();
    expect(parseArguments([...args, '--model-mode', 'fixture']).modelMode).toBe('fixture');
    expect(
      parseArguments([
        ...args,
        '--model-mode',
        'live',
        '--config',
        'C:/Path with spaces/config.toml',
        '--provider',
        'test',
        '--model',
        'test-model',
        '--credential-state',
        'C:/Original profile/Local State',
      ]),
    ).toMatchObject({
      modelMode: 'live',
      config: 'C:/Path with spaces/config.toml',
      provider: 'test',
      model: 'test-model',
      credentialState: 'C:/Original profile/Local State',
    });
  });
  it.each([
    ['debug', 'session', '--output', 'x', '--model-mode', 'live'],
    ['debug', 'session', '--output', 'x', '--model-mode', 'fixture', '--config', 'x'],
    ['debug', 'session', '--output', 'x', '--provider', 'x'],
    ['debug', 'ui', '--output', 'x', '--model-mode', 'fixture'],
    ['doctor', '--model-mode', 'live', '--config', 'x'],
    ['debug', 'session', '--output', 'x', '--credential-state', 'x'],
    ['debug', 'session', '--output', 'x', '--codex-auth', 'x'],
    [
      'debug',
      'session',
      '--output',
      'x',
      '--model-mode',
      'live',
      '--config',
      'x',
      '--codex-auth',
      'x',
      '--credential-state',
      'x',
    ],
  ])('rejects ambiguous model arguments %j', (...args) => {
    expect(() => parseArguments(args)).toThrow();
  });
  it('classifies model setup errors without echoing credentials or raw diagnostics', () => {
    const config = modelSetupError([
      { source: 'model-setup', message: 'BACKGROUND_MODEL_CONFIG_INVALID' },
    ]);
    expect(config?.category).toBe('configuration');
    expect(
      modelSetupError([{ source: 'model-setup', message: 'BACKGROUND_MODEL_OAUTH_UNSUPPORTED' }])
        ?.category,
    ).toBe('unsupported');
    expect(modelSetupError([{ source: 'console', message: 'private-sentinel' }])).toBeUndefined();
  });
});
