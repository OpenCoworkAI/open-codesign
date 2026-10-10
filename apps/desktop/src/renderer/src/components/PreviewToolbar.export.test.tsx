import { availableLocales, i18n, initI18n, setLocale } from '@open-codesign/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CodesignState, useCodesignStore } from '../store';
import { PreviewToolbar } from './PreviewToolbar';
import type { PreviewMenuItem } from './PreviewToolbarMenu';

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    useCodesignStore: Object.assign(
      (selector: (state: CodesignState) => unknown) => selector(actual.useCodesignStore.getState()),
      actual.useCodesignStore,
    ),
  };
});

const menus = vi.hoisted(() => new Map<string, { items: PreviewMenuItem[]; disabled: boolean }>());
vi.mock('./PreviewToolbarMenu', () => ({
  PreviewToolbarMenu: (props: { label: string; items: PreviewMenuItem[]; disabled: boolean }) => {
    menus.set(props.label, props);
    return null;
  },
}));

const initialState = useCodesignStore.getState();
const exportActive = vi.fn();

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(async () => {
  await setLocale('en');
  menus.clear();
  exportActive.mockClear();
  useCodesignStore.setState({
    ...initialState,
    previewSource: '<section>Deck</section>',
    exportActive,
  });
});

function exportMenu() {
  renderToStaticMarkup(<PreviewToolbar />);
  const menu = menus.get(i18n.t('export.button'));
  if (!menu) throw new Error('Missing export menu');
  return menu;
}

describe('preview export menu', () => {
  it('keeps all default exports and adds a separate native PPTX action', () => {
    const { items, disabled } = exportMenu();
    expect(disabled).toBe(false);
    expect(items.map((item) => item.id)).toEqual([
      'html',
      'pdf',
      'pptx',
      'pptx-native',
      'zip',
      'markdown',
    ]);
    for (const item of items) item.onSelect();
    expect(exportActive.mock.calls).toEqual([
      ['html'],
      ['pdf'],
      ['pptx'],
      ['pptx', 'native'],
      ['zip'],
      ['markdown'],
    ]);
    expect(items.find((item) => item.id === 'pptx')?.label).toBe('PPTX');
    expect(items.find((item) => item.id === 'pptx-native')?.label).toBe('PPTX (editable, beta)');
  });

  it('disables the export menu without a preview', () => {
    useCodesignStore.setState({ previewSource: null });
    expect(exportMenu().disabled).toBe(true);
  });

  it.each(
    availableLocales,
  )('uses a translated native label and fallback hint in %s', async (locale) => {
    await setLocale(locale);
    const item = exportMenu().items.find((candidate) => candidate.id === 'pptx-native');
    for (const field of ['label', 'hint'] as const) {
      const translated = i18n.getResource(
        locale,
        'translation',
        `export.items.pptxNative.${field}`,
      );
      expect(typeof translated).toBe('string');
      expect(translated.length).toBeGreaterThan(0);
      expect(item?.[field]).toBe(translated);
    }
  });
});
