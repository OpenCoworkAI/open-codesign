import { describe, expect, it } from 'vitest';
import {
  defaultDesignMd,
  generateDesignSystemSample,
  syncDesignSystemSample,
} from './design-system-sample';

describe('design system sample', () => {
  it('updates generated tokens from the canonical document while preserving custom JSX', () => {
    const md = defaultDesignMd('Studio');
    const original = generateDesignSystemSample(md, 'stripe').replace(
      'Clear decisions.',
      'Custom composition.',
    );
    const updated = syncDesignSystemSample(md.replace('#28665c', '#123456'), original);
    expect(updated).toContain('#123456');
    expect(updated).not.toContain('#28665c');
    expect(updated).toContain('Custom composition.');
    expect(updated).toContain('"style":"stripe"');
  });
  it('embeds imported names as data and never injects executable script tags', () => {
    const source = generateDesignSystemSample(
      defaultDesignMd('</script><script>globalThis.injected=true</script>'),
    );
    expect(source).not.toContain('</script>');
    expect(source).toContain('\\u003c/script');
    expect(source).not.toContain('import React');
    expect(source).toContain('function App()');
  });
  it('resolves existing portable component names and token references', () => {
    const md = defaultDesignMd('Studio').replace('primaryButton:', 'button-primary:');
    const source = generateDesignSystemSample(md);
    expect(source).toContain('"primaryKey":"button-primary"');
    expect(source).toContain('"buttonBackground":"#28665c"');
    expect(source).toContain('"buttonRadius":"8px"');
  });
});
