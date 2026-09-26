import { readFile } from 'node:fs/promises';
import { i18n, initI18n } from '@open-codesign/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import {
  sourceEditOriginMessage,
  sourceEditReasonKeys,
  sourceEditReasonMessage,
} from './source-edit-messages';

const t = (key: string) => String(i18n.t(key));
afterEach(async () => {
  await initI18n('en');
});

describe('localized source edit explanations', () => {
  it('provides Chinese and English explanations for every supported reason code', async () => {
    for (const locale of ['zh-CN', 'en']) {
      await initI18n(locale);
      for (const code of Object.keys(sourceEditReasonKeys)) {
        const message = sourceEditReasonMessage(code, t);
        expect(message).not.toContain('canvas.sourceEdit');
        expect(message).not.toContain('⟦');
        expect(message).not.toBe(code);
        expect(message.length).toBeGreaterThan(10);
        if (locale === 'zh-CN') expect(message).toMatch(/[\u4e00-\u9fff]/);
        else expect(message).not.toMatch(/[\u4e00-\u9fff]/);
      }
    }
  });
  it('uses a safe localized fallback for unknown or inherited codes', async () => {
    await initI18n('zh-CN');
    const fallback = t('canvas.sourceEdit.reasons.unknown');
    for (const code of ['new-backend-error', 'constructor', 'toString', '__proto__', '']) {
      expect(sourceEditReasonMessage(code, t)).toBe(fallback);
    }
    await initI18n('en');
    expect(sourceEditReasonMessage('future-code', t)).toBe(t('canvas.sourceEdit.reasons.unknown'));
  });
  it('describes shared source definitions and operational failures in the current language', async () => {
    await initI18n('zh-CN');
    expect(sourceEditOriginMessage(t)).toContain('所有引用');
    expect(sourceEditReasonMessage('stale-source', t)).toContain('源码已发生变化');
    expect(sourceEditReasonMessage('busy', t)).toContain('等待生成结束');
    expect(sourceEditReasonMessage('dynamic-attribute', t)).toContain('静态字符串');
    expect(sourceEditReasonMessage('no-inline-style', t)).toContain('不能在这里新增样式');
    for (const key of ['inspectFailed', 'saveFailed', 'refreshWarning', 'diagnostics']) {
      expect(t(`canvas.sourceEdit.${key}`)).toMatch(/[\u4e00-\u9fff]/);
    }
  });
  it('covers all literal reasons currently emitted by source inspection and saving', async () => {
    const sources = await Promise.all(
      [
        '../../../main/source-edit-engine.ts',
        '../../../main/source-edits-ipc.ts',
        '../../../main/source-edit-atomic.ts',
      ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
    );
    const codes = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(
        /(?:reject(?:ed)?|new SourceEditCommitError)\(\s*'([^']+)'/g,
      ))
        if (match[1]) codes.add(match[1]);
      for (const match of source.matchAll(
        /problem\(\s*'(?:target|text|attributes|style)'\s*,\s*'([^']+)'/g,
      ))
        if (match[1]) codes.add(match[1]);
    }
    expect(codes.size).toBeGreaterThan(35);
    for (const code of codes) expect(Object.hasOwn(sourceEditReasonKeys, code), code).toBe(true);
  });
});
