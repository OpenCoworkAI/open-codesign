import type { SourceIdentityV1 } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import { composeSystemPrompt, PROMPT_SECTIONS } from './index.js';

const source: SourceIdentityV1 = {
  schemaVersion: 1,
  path: 'pages/main.htm',
  format: 'html',
  runtimeMode: 'native-html',
};
describe('native authoring prompts', () => {
  it.each(['create', 'revise', 'tweak'] as const)('uses native guidance for %s', (mode) => {
    const prompt = composeSystemPrompt({ mode, source });
    expect(prompt).toContain('pages/main.htm');
    expect(prompt).toContain('full HTML document');
    expect(prompt).toContain('static HTML');
    expect(prompt).toContain('authored bindings');
    expect(prompt).toContain('does not inject');
    expect(prompt).not.toContain('Define `App`');
    expect(prompt).not.toContain('ReactDOM.createRoot');
    expect(prompt).not.toContain('Virtual `frames/*`');
    expect(prompt).not.toContain('runtime exposes `--ocd-tweak');
    expect(prompt).toContain('authoritative');
  });
  it('keeps legacy output and allows explicit feature opt-out', () => {
    expect(composeSystemPrompt({ mode: 'create' })).toContain('Define `App`');
    const prompt = composeSystemPrompt({
      mode: 'create',
      source,
      featureProfile: {
        tweaks: { mode: 'disabled', provenance: 'explicit', confidence: 'high' },
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
    });
    expect(prompt).toContain('Do not create controls or call `tweaks()`');
    expect(PROMPT_SECTIONS['nativeOutputRules']).toContain('full HTML document');
  });
});
