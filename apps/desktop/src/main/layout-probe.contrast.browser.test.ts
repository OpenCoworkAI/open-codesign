import { describe, expect, it } from 'vitest';
import { chrome, DESKTOP, useChromePage } from './layout-browser-kit';
import { inspectLayout } from './layout-probe';

describe.skipIf(!chrome)('contrast checks in system Chrome', () => {
  const { page, mount } = useChromePage('layout-contrast');

  const contrastOf = async (markup: string) => {
    await mount(markup);
    const { issues, notes } = await inspectLayout(page());
    return { issues: issues.filter((issue) => issue.check === 'low-contrast'), notes };
  };

  describe('text and background', () => {
    it('reports grey text on white that is just under 4.5:1, with both colours', async () => {
      const { issues, notes } = await contrastOf('<p id="note" style="color:#777">Fine print</p>');

      expect(notes).toEqual([]);
      expect(issues).toEqual([
        {
          check: 'low-contrast',
          viewportWidth: DESKTOP.width,
          selector: 'p#note',
          message:
            'p#note has low text contrast: 4.47:1 for #777777 on #ffffff, but text needs 4.5:1.',
          measured: 4.47,
          limit: 4.5,
        },
      ]);
    });

    it('accepts text at 4.5:1 and above, and the browser default of black on white', async () => {
      expect(
        (await contrastOf('<p style="color:#767676">Readable</p><p>Default colours</p>')).issues,
      ).toEqual([]);
    });

    it('asks only 3:1 of text that is 24 px, or 18.66 px and bold', async () => {
      const grey = 'color:#949494';

      expect((await contrastOf(`<h1 style="${grey};font-size:24px">Large</h1>`)).issues).toEqual(
        [],
      );
      expect(
        (await contrastOf(`<p style="${grey};font-size:19px;font-weight:700">Bold</p>`)).issues,
      ).toEqual([]);
      expect(
        (await contrastOf(`<p style="${grey};font-size:19px">Not bold</p>`)).issues,
      ).toHaveLength(1);
      expect((await contrastOf(`<p style="${grey}">Small</p>`)).issues).toHaveLength(1);
    });

    it('takes the background from the nearest ancestor that sets one', async () => {
      const { issues } = await contrastOf(
        '<section style="background:#222"><div><p id="dim" style="color:#444">Dim on dark</p></div></section>',
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain('p#dim has low text contrast');
      expect(issues[0]?.message).toContain('#444444 on #222222');
    });

    it('lays a translucent background over what is behind it', async () => {
      const { issues } = await contrastOf(
        '<div style="background:rgba(0,0,0,.5)"><p id="badge" style="color:#fff">New</p></div>',
      );

      expect(issues[0]?.message).toBe(
        'p#badge has low text contrast: 3.97:1 for #ffffff on #808080, but text needs 4.5:1.',
      );
    });

    it('lays translucent text over its background', async () => {
      const { issues } = await contrastOf(
        '<p id="soft" style="color:rgba(0,0,0,.5)">Half-transparent text</p>',
      );

      expect(issues[0]?.message).toContain('#808080 on #ffffff');
    });

    it('reads colours in spaces other than sRGB', async () => {
      const { issues } = await contrastOf(
        `<p id="a" style="color:oklch(0.85 0 0)">oklch</p>
         <p id="b" style="color:color-mix(in srgb, black 40%, white)">color-mix</p>`,
      );

      expect(issues.map((issue) => issue.selector).sort()).toEqual(['p#a', 'p#b']);
      expect(issues.find((issue) => issue.selector === 'p#b')?.message).toContain('#999999');
    });
  });

  describe('what is reported once, and what is not measured', () => {
    it('reports one finding for text elements that share a colour pair, and says how many', async () => {
      const { issues } = await contrastOf(
        Array.from(
          { length: 5 },
          (_, index) => `<p class="hint-${index}" style="color:#999">Hint</p>`,
        ).join(''),
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toMatch(/5 text elements use this pair\.$/);
    });

    it('lists the worst pair first', async () => {
      const { issues } = await contrastOf(
        `<p id="mild" style="color:#888">Mild</p><p id="bad" style="color:#ccc">Bad</p>`,
      );

      expect(issues.map((issue) => issue.selector)).toEqual(['p#bad', 'p#mild']);
    });

    it('does not guess on an image or gradient, and counts what it skipped', async () => {
      const { issues, notes } = await contrastOf(
        '<div style="background:linear-gradient(#000,#fff)"><p style="color:#777">Over a gradient</p></div>',
      );

      expect(issues).toEqual([]);
      expect(notes).toEqual([
        'Contrast was not checked for 1 text element on a background image or gradient, or partly transparent.',
      ]);
    });

    it('does not measure partly transparent elements', async () => {
      const { issues, notes } = await contrastOf(
        '<div style="opacity:.5"><p style="color:#777">Faded</p></div><p style="color:#777;opacity:.4">Faded too</p>',
      );

      expect(issues).toEqual([]);
      expect(notes).toEqual([
        'Contrast was not checked for 2 text elements on a background image or gradient, or partly transparent.',
      ]);
    });

    it('ignores text nobody can see', async () => {
      const { issues, notes } = await contrastOf(
        `<p style="color:#ccc;visibility:hidden">Hidden</p>
         <p style="color:#ccc;display:none">Not rendered</p>
         <p style="color:#ccc;width:0;height:0;overflow:hidden"></p>`,
      );

      expect(issues).toEqual([]);
      expect(notes).toEqual([]);
    });

    it('measures the element that holds the text, not a container whose children have their own', async () => {
      const { issues } = await contrastOf(
        '<div style="color:#ccc"><span style="color:#000">Black text</span></div>',
      );

      expect(issues).toEqual([]);
    });

    it('measures only at the current width, so a finding is not repeated at phone width', async () => {
      const { issues } = await contrastOf('<p id="note" style="color:#777">Fine print</p>');

      expect(issues.map((issue) => issue.viewportWidth)).toEqual([DESKTOP.width]);
    });
  });
});
