import { describe, expect, it } from 'vitest';
import { chrome, DESKTOP, useChromePage } from './layout-browser-kit';
import { inspectLayout } from './layout-probe';
import { PHONE_VIEWPORT } from './layout-samples';

describe.skipIf(!chrome)('tap targets and control names in system Chrome', () => {
  const { page, mount } = useChromePage('layout-accessibility');

  const inspect = async (markup: string) => {
    await mount(markup);
    return inspectLayout(page());
  };
  const targetsIn = async (markup: string) =>
    (await inspect(markup)).issues.filter((issue) => issue.check === 'small-target');
  const namesIn = async (markup: string) =>
    (await inspect(markup)).issues.filter((issue) => issue.check === 'missing-name');

  const square = (size: number, extra = '') =>
    `width:${size}px;height:${size}px;padding:0;border:0;${extra}`;

  describe('tap targets', () => {
    // A small target is only a problem when another target is within 24 px of it (WCAG 2.2 SC 2.5.8).
    const neighbour = `<button aria-label="Neighbour" style="${square(44)}"></button>`;
    // Wide enough to sit under a link in a sentence.
    const bar = `<button aria-label="Bar" style="display:block;width:300px;height:44px;padding:0;border:0"></button>`;

    it('reports a small button next to another target at phone width, with its size', async () => {
      const issues = await targetsIn(
        `<div style="display:flex"><button id="close" aria-label="Close" style="${square(16)}"></button>${neighbour}</div>`,
      );

      expect(issues).toEqual([
        {
          check: 'small-target',
          viewportWidth: PHONE_VIEWPORT.width,
          selector: 'button#close',
          message:
            'button#close is 16 × 16 px; a tap target should be at least 24 × 24 px, or have that much room around it.',
          measured: 16,
          limit: 24,
        },
      ]);
    });

    it('accepts a target of 24 px, and reports one that is short in only one direction', async () => {
      expect(
        await targetsIn(
          `<div style="display:flex"><button aria-label="Ok" style="${square(24)}"></button>${neighbour}</div>`,
        ),
      ).toEqual([]);
      const issues = await targetsIn(
        `<div style="display:flex;flex-direction:column;align-items:flex-start"><button id="wide" aria-label="Wide" style="width:60px;height:20px;padding:0;border:0"></button>${neighbour}</div>`,
      );
      expect(issues.map((issue) => [issue.selector, issue.measured])).toEqual([
        ['button#wide', 20],
      ]);
    });

    it('passes a lone small target, because nothing else is within 24 px of it', async () => {
      expect(await targetsIn(`<button aria-label="Close" style="${square(16)}"></button>`)).toEqual(
        [],
      );
    });

    it('does not ask a link inside a sentence to be 24 px', async () => {
      expect(
        await targetsIn(
          `<p style="margin:0">Read <a href="#terms">the terms</a> before you start.</p>${bar}`,
        ),
      ).toEqual([]);
      const issues = await targetsIn(
        `<div style="display:flex;flex-direction:column;align-items:flex-start"><a id="chip" href="#x" style="display:inline-block;height:16px;width:60px">Chip</a>${neighbour}</div>`,
      );
      expect(issues.map((issue) => issue.selector)).toEqual(['a#chip']);
    });

    it('lets a small target pass when no other target is within the 24 px square around it', async () => {
      const spaced = `<div style="display:flex;gap:40px">
        <button id="a" aria-label="A" style="${square(16)}"></button>
        <button id="b" aria-label="B" style="${square(16)}"></button></div>`;
      const touching = `<div style="display:flex;gap:0">
        <button id="a" aria-label="A" style="${square(16)}"></button>
        <button id="b" aria-label="B" style="${square(16)}"></button></div>`;

      expect(await targetsIn(spaced)).toEqual([]);
      expect((await targetsIn(touching)).map((issue) => issue.selector)).toEqual([
        'button#a',
        'button#b',
      ]);
    });

    it.each([
      ['disabled', `<button disabled aria-label="Off" style="${square(10)}"></button>`],
      ['not rendered', `<button aria-label="Gone" style="${square(10)};display:none"></button>`],
      ['invisible', `<button aria-label="Ghost" style="${square(10)};visibility:hidden"></button>`],
      ['transparent', `<button aria-label="Faded" style="${square(10)};opacity:0"></button>`],
      [
        'hidden from assistive technology',
        `<span aria-hidden="true"><button aria-label="Decoration" style="${square(10)}"></button></span>`,
      ],
      [
        'a visually hidden input whose label is the target',
        '<label>Custom check <input type="checkbox" style="position:absolute;width:1px;height:1px;opacity:0"></label>',
      ],
    ])(
      'skips a control that is %s, even with a target right next to it',
      async (_label, markup) => {
        expect(await targetsIn(`<div style="display:flex">${markup}${neighbour}</div>`)).toEqual(
          [],
        );
      },
    );

    it('names the smallest first, at most five, and says how many more there were', async () => {
      const buttons = [17, 12, 15, 10, 16, 14, 13, 11]
        .map(
          (size) => `<button id="b${size}" aria-label="B${size}" style="${square(size)}"></button>`,
        )
        .join('');

      const { issues, notes } = await inspect(`<div style="display:flex">${buttons}</div>`);

      expect(
        issues.filter((issue) => issue.check === 'small-target').map((issue) => issue.measured),
      ).toEqual([10, 11, 12, 13, 14]);
      expect(notes).toEqual(['3 more findings past the per-check limits were not listed.']);
    });

    it('says so when the page has more controls than it looks at', async () => {
      const buttons = Array.from(
        { length: 401 },
        () => `<button aria-label="x" style="${square(30)}"></button>`,
      );

      const { notes } = await inspect(buttons.join(''));

      expect(notes).toEqual([
        'Layout checks did not cover the whole page (more than 5,000 elements or 400 controls); the rest was not measured.',
      ]);
    });

    it('measures at phone width only, so a small target is reported once', async () => {
      const { issues } = await inspect(
        `<div style="display:flex"><button id="x" aria-label="X" style="${square(16)}"></button>${neighbour}</div>`,
      );

      expect(issues.map((issue) => issue.viewportWidth)).toEqual([PHONE_VIEWPORT.width]);
    });
  });

  describe('control names', () => {
    it('reports an icon button that has no text, with the tag in the message', async () => {
      const issues = await namesIn(
        '<button id="menu"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M0 2h16M0 8h16"/></svg></button>',
      );

      expect(issues).toEqual([
        {
          check: 'missing-name',
          viewportWidth: DESKTOP.width,
          selector: 'button#menu',
          message:
            'button#menu (button) has no accessible name: it has no text, aria-label, aria-labelledby, label or title.',
        },
      ]);
    });

    it.each([
      ['text', '<button>Save</button>'],
      ['aria-label', '<button aria-label="Close"><svg width="8" height="8"></svg></button>'],
      [
        'aria-labelledby',
        '<span id="t">Search</span><button aria-labelledby="t"><svg width="8" height="8"></svg></button>',
      ],
      ['title', '<button title="Delete"><svg width="8" height="8"></svg></button>'],
      ['a label for the input', '<label for="q">Search</label><input id="q" type="search">'],
      ['a wrapping label', '<label>Email <input type="email"></label>'],
      ['the alt of an image in a link', '<a href="/"><img alt="Home" width="8" height="8"></a>'],
      [
        'the title of an svg in a button',
        '<button><svg width="8" height="8"><title>Menu</title></svg></button>',
      ],
      ['the default of a submit input', '<input type="submit">'],
      ['the value of a button input', '<input type="button" value="Go">'],
      ['text in a role=button element', '<div role="button" tabindex="0">Open</div>'],
    ])('accepts a control named by %s', async (_label, markup) => {
      expect(await namesIn(markup)).toEqual([]);
    });

    it.each([
      ['an empty button', '<button></button>', 'button'],
      ['a link with an empty alt image', '<a href="/"><img alt="" width="8" height="8"></a>', 'a'],
      ['an input with only a placeholder', '<input type="text" placeholder="Search">', 'input'],
      ['an empty link', '<a href="/x"></a>', 'a'],
      ['a select with no label', '<select><option>One</option></select>', 'select'],
      [
        'a role=switch element with no text',
        '<div role="switch" tabindex="0"></div>',
        'div role=switch',
      ],
    ])('reports %s', async (_label, markup, kind) => {
      const issues = await namesIn(markup);

      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain(`(${kind})`);
    });

    it('skips controls that are hidden from the user and from assistive technology', async () => {
      expect(
        await namesIn(
          `<button style="display:none"></button>
           <button style="visibility:hidden"></button>
           <span aria-hidden="true"><button></button></span>
           <input type="hidden" name="token">`,
        ),
      ).toEqual([]);
    });

    it('names at most five controls, and says how many more there were', async () => {
      const { issues, notes } = await inspect(
        Array.from(
          { length: 8 },
          (_, index) => `<button id="icon${index}" style="${square(30)}"></button>`,
        ).join(''),
      );

      expect(issues.filter((issue) => issue.check === 'missing-name')).toHaveLength(5);
      expect(notes).toEqual(['3 more findings past the per-check limits were not listed.']);
    });

    it('checks at the current width only, so a finding is not repeated at phone width', async () => {
      const { issues } = await inspect('<button id="menu"></button>');

      expect(issues.map((issue) => issue.viewportWidth)).toEqual([DESKTOP.width]);
    });
  });
});
