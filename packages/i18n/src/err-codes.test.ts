import { ERROR_CODES } from '@open-codesign/shared';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';
import zhCN from './locales/zh-CN.json';

describe('error-code i18n coverage', () => {
  const locales = [
    { name: 'en', data: en as unknown as { err?: Record<string, string> } },
    { name: 'zh-CN', data: zhCN as unknown as { err?: Record<string, string> } },
    { name: 'pt-BR', data: ptBR as unknown as { err?: Record<string, string> } },
    { name: 'es', data: es as unknown as { err?: Record<string, string> } },
  ];

  for (const locale of locales) {
    it(`${locale.name} has a non-empty err.<CODE> string for every ERROR_CODES value`, () => {
      const errBlock = locale.data.err;
      expect(errBlock, `${locale.name} is missing the top-level "err" block`).toBeDefined();
      for (const code of Object.values(ERROR_CODES)) {
        const value = errBlock?.[code];
        expect(
          typeof value === 'string' && value.length > 0,
          `${locale.name}: missing or empty err.${code}`,
        ).toBe(true);
      }
    });
  }
});
