import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PreviewStep } from '@open-codesign/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isPreviewFileUrlAllowed,
  isRuntimeConsoleNoise,
  isRuntimeOptionalFontUrl,
  previewIncludesRuntimeFontLinks,
  runPreview,
} from './preview-runtime';

vi.mock('./logger', () => ({
  getLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

// Puppeteer-core is a thin Chrome DevTools client — when no system Chrome is
// discoverable (typical CI sandbox), the module itself still imports fine but
// `findSystemChrome` throws EXPORTER_NO_CHROME. We key availability off that
// discovery so CI runs stay green without Chrome installed.
async function canRunChrome(): Promise<boolean> {
  try {
    const { findSystemChrome } = await import('@open-codesign/exporters');
    await findSystemChrome();
    return true;
  } catch {
    return false;
  }
}

const chromeAvailable = await canRunChrome();
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
const describeIfChrome = chromeAvailable ? describe : describe.skip;

let tempDir = '';

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'codesign-preview-runtime-'));
});

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('runPreview path guards', () => {
  it('refuses paths that escape the workspace', async () => {
    const result = await runPreview({
      path: '../etc/passwd',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/escapes workspace root/);
  });

  it('reports read failure when the target does not exist', async () => {
    const result = await runPreview({
      path: 'missing.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/read failed/);
  });

  it('refuses preview sources through symlinked workspace segments', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-outside-'));
    try {
      mkdirSync(join(tempDir, 'linked-parent'), { recursive: true });
      try {
        symlinkSync(outside, join(tempDir, 'linked-parent', 'linked'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }
      writeFileSync(join(outside, 'index.html'), '<main>outside</main>', 'utf8');

      const result = await runPreview({
        path: 'linked-parent/linked/index.html',
        vision: false,
        workspaceRoot: tempDir,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/symbolic link/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('allows only preview temp file and safe workspace file URLs', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-url-outside-'));
    const previewFile = join(outside, 'preview.html');
    const safeFile = join(tempDir, 'asset.txt');
    writeFileSync(previewFile, '<main/>', 'utf8');
    writeFileSync(safeFile, 'asset', 'utf8');
    try {
      expect(
        await isPreviewFileUrlAllowed(pathToFileURL(previewFile).href, tempDir, previewFile),
      ).toBe(true);
      expect(
        await isPreviewFileUrlAllowed(pathToFileURL(safeFile).href, tempDir, previewFile),
      ).toBe(true);
      expect(
        await isPreviewFileUrlAllowed(
          pathToFileURL(join(outside, 'secret.txt')).href,
          tempDir,
          previewFile,
        ),
      ).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('blocks file URLs that traverse symlinked workspace segments', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codesign-preview-url-link-outside-'));
    const previewFile = join(outside, 'preview.html');
    writeFileSync(previewFile, '<main/>', 'utf8');
    writeFileSync(join(outside, 'secret.txt'), 'secret', 'utf8');
    try {
      try {
        symlinkSync(outside, join(tempDir, 'asset-link'), 'dir');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
        throw err;
      }

      expect(
        await isPreviewFileUrlAllowed(
          pathToFileURL(join(tempDir, 'asset-link', 'secret.txt')).href,
          tempDir,
          previewFile,
        ),
      ).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(tempDir, 'asset-link'), { recursive: true, force: true });
    }
  });

  it('reports unsupported file types before launching Chrome', async () => {
    writeFileSync(join(tempDir, 'style.css'), 'body { color: red; }', 'utf8');
    const result = await runPreview({
      path: 'style.css',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Unsupported preview file type/);
  });
});

describe('runtime noise filtering', () => {
  it('recognizes explicitly marked runtime font subsets without requiring Fraunces first', () => {
    expect(
      previewIncludesRuntimeFontLinks(
        '<link data-codesign-runtime-fonts href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&amp;display=swap" rel="stylesheet" />',
      ),
    ).toBe(true);
    expect(previewIncludesRuntimeFontLinks('<main>System fonts only</main>')).toBe(false);
    expect(
      previewIncludesRuntimeFontLinks(
        '<link href="https://fonts.googleapis.com/css2?family=Custom" />',
      ),
    ).toBe(false);
  });
  it('recognizes only the optional fonts injected by the JSX preview wrapper', () => {
    expect(
      isRuntimeOptionalFontUrl(
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap',
      ),
    ).toBe(true);
    expect(isRuntimeOptionalFontUrl('https://fonts.gstatic.com/s/dmsans/v16/example.woff2')).toBe(
      true,
    );
    expect(isRuntimeOptionalFontUrl('https://example.com/assets/hero.png')).toBe(false);
    expect(isRuntimeOptionalFontUrl('file:///tmp/workspace/assets/hero.png')).toBe(false);
  });

  it('filters optional runtime font console failures only when the wrapper is active', () => {
    const message = 'Failed to load resource: net::ERR_NETWORK_CHANGED';
    const locationUrl =
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300&display=swap';
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl,
      }),
    ).toBe(true);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: false,
        locationUrl,
      }),
    ).toBe(false);
    expect(
      isRuntimeConsoleNoise(message, {
        ignoreOptionalRuntimeFontFailures: true,
        locationUrl: 'https://example.com/assets/hero.png',
      }),
    ).toBe(false);
  });
});

describeIfChrome('runPreview with real Chrome', () => {
  it('selects a native controlled React option and updates linked summary state', async () => {
    writeFileSync(
      join(tempDir, 'Select.jsx'),
      `
      function App() {
        const [category, setCategory] = React.useState('home');
        return <main><label htmlFor="category">Category</label>
          <select id="category" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">Choose a category</option>
            <option value="home">Home</option>
            <option value="work">Work projects</option>
          </select>
          <p id="summary">{category === 'work' ? 'Work projects selected' : category === 'home' ? 'Home selected' : 'No category selected'}</p>
        </main>;
      }
    `,
      'utf8',
    );
    const result = await runPreview({
      path: 'Select.jsx',
      vision: false,
      workspaceRoot: tempDir,
      steps: [
        { action: 'select', selector: '#category', value: 'work' },
        { action: 'assert', selector: '#category', value: 'work' },
        { action: 'assert', selector: '#summary', text: 'Work projects selected' },
        { action: 'select', selector: '#category', value: '' },
        { action: 'assert', selector: '#category', value: '' },
        { action: 'assert', selector: '#summary', text: 'No category selected' },
      ],
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.steps).toHaveLength(6);
    expect(result.steps?.[0]).toMatchObject({ action: 'select', selector: '#category', ok: true });
    expect(result.visibleText).toContain('No category selected');
    expect(result.visibleText).toContain('"value":"work","label":"Work projects"');
  }, 30_000);

  it.each([
    ['#missing', 'work', /Missing selector/],
    ['.ambiguous', 'work', /Ambiguous selector/],
    ['#not-select', 'work', /native HTML select/],
    ['#multiple', 'work', /multiple-selection/],
    ['#disabled', 'work', /disabled/],
    ['#fieldset-select', 'work', /disabled or inert/],
    ['#disabled-option', 'work', /Option.*disabled/],
    ['#disabled-group', 'work', /disabled optgroup/],
    ['#valid', 'missing', /No option.*missing.*exists/],
    ['#duplicate-value', 'work', /Ambiguous option value/],
    ['#hidden', 'work', /not visible/],
  ])(
    'rejects invalid native select target %s value %s without mutation',
    async (selector, value, reason) => {
      const options = '<option value="home">Home</option><option value="work">Work</option>';
      writeFileSync(
        join(tempDir, 'select-failure.html'),
        `<!doctype html>
      <input id="not-select">
      <select id="multiple" multiple>${options}</select>
      <select id="disabled" disabled>${options}</select>
      <fieldset disabled><select id="fieldset-select">${options}</select></fieldset>
      <select id="disabled-option"><option value="home">Home</option><option value="work" disabled>Work</option></select>
      <select id="disabled-group"><option value="home">Home</option><optgroup label="Unavailable" disabled><option value="work">Work</option></optgroup></select>
      <select id="valid">${options}</select>
      <select id="duplicate-value">${options}<option value="work">Duplicate</option></select>
      <select id="hidden" hidden>${options}</select>
      <select class="ambiguous">${options}</select><select class="ambiguous">${options}</select>
      <p id="events">No changes</p>
      <script>document.addEventListener('change', () => { document.getElementById('events').textContent = 'Changed'; });</script>
    `,
        'utf8',
      );
      const result = await runPreview({
        path: 'select-failure.html',
        vision: false,
        workspaceRoot: tempDir,
        steps: [
          { action: 'select', selector, value },
          { action: 'assert', selector: '#events', text: 'Changed' },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps?.[0]).toMatchObject({ action: 'select', selector, ok: false });
      expect(result.steps?.[0]?.reason).toMatch(reason);
      expect(result.visibleText).toContain('No changes');
    },
    30_000,
  );

  it('respects the enabled first-legend exception inside a disabled fieldset', async () => {
    writeFileSync(
      join(tempDir, 'select-legend.html'),
      '<!doctype html><fieldset disabled><legend><select id="legend-select"><option value="home">Home</option><option value="work">Work</option></select></legend></fieldset>',
      'utf8',
    );
    const result = await runPreview({
      path: 'select-legend.html',
      vision: false,
      workspaceRoot: tempDir,
      steps: [
        { action: 'select', selector: '#legend-select', value: 'work' },
        { action: 'assert', selector: '#legend-select', value: 'work' },
      ],
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
  }, 30_000);

  it('exercises controlled React input, shared task state, completion, navigation and back at mobile size', async () => {
    writeFileSync(
      join(tempDir, 'Todo.jsx'),
      `
      function App() {
        const [view, setView] = React.useState('tasks');
        const [draft, setDraft] = React.useState('');
        const [tasks, setTasks] = React.useState([]);
        return <main>
          {view === 'tasks' ? <section id="tasks-view">
            <form onSubmit={event => { event.preventDefault(); setTasks([...tasks, {title:draft,done:false}]); setDraft(''); }}>
              <label htmlFor="new-task">New task</label>
              <input id="new-task" value={draft} onChange={event => setDraft(event.target.value)} />
              <button id="add-task" type="submit">Add task</button>
            </form>
            <ul id="task-list">{tasks.map((task,index) => <li key={index}>
              <button id={'complete-'+index} onClick={() => setTasks(tasks.map((item,i) => i === index ? {...item,done:!item.done} : item))}>{task.done ? 'Completed: ' : 'Active: '}{task.title}</button>
            </li>)}</ul>
            <button id="settings" onClick={() => setView('settings')}>Settings</button>
          </section> : <section><h1 id="settings-title">Settings</h1>
            <p id="summary">{tasks.filter(task => task.done).length} completed</p>
            <button id="back" onClick={() => setView('tasks')}>Back to tasks</button>
          </section>}
        </main>;
      }
    `,
      'utf8',
    );
    const steps: PreviewStep[] = [
      { action: 'assert', selector: '#new-task', visible: true },
      { action: 'fill', selector: '#new-task', value: 'Buy milk' },
      { action: 'assert', selector: '#new-task', value: 'Buy milk' },
      { action: 'press', selector: '#new-task', key: 'Enter' },
      { action: 'assert', selector: '#task-list', text: 'Active: Buy milk' },
      { action: 'assert', selector: '#new-task', value: '' },
      { action: 'click', selector: '#complete-0' },
      { action: 'click', selector: '#settings' },
      { action: 'assert', selector: '#settings-title', visible: true, text: 'Settings' },
      { action: 'assert', selector: '#summary', text: '1 completed' },
      { action: 'assert', selector: '#tasks-view', visible: false },
      { action: 'click', selector: '#back' },
      { action: 'assert', selector: '#task-list', text: 'Completed: Buy milk' },
      { action: 'fill', selector: '#new-task', value: 'Take a walk' },
      { action: 'click', selector: '#add-task' },
      { action: 'assert', selector: '#task-list', text: 'Active: Take a walk' },
    ];
    const result = await runPreview({
      path: 'Todo.jsx',
      vision: false,
      workspaceRoot: tempDir,
      viewport: { width: 390, height: 844 },
      steps,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.steps).toHaveLength(16);
    expect(result.steps?.every((step) => step.ok)).toBe(true);
    expect(result.metrics.width).toBe(390);
    expect(result.metrics.height).toBeGreaterThanOrEqual(844);
    expect(result.visibleText).toContain('Completed: Buy milk');
    expect(result.visibleText).toContain('Active: Take a walk');
    expect(result.visibleText).toContain('id="new-task"');
    expect(result.domOutline).toContain('main');
  }, 30_000);

  it.each([
    [{ action: 'click', selector: '#missing' }, /Missing selector/],
    [{ action: 'click', selector: 'button' }, /Ambiguous selector.*2/],
    [{ action: 'click', selector: '[' }, /not a valid selector/],
    [
      { action: 'assert', selector: '#title', text: 'Wrong title' },
      /Expected visible text.*Wrong title.*Ready/,
    ],
    [{ action: 'assert', selector: '#field', value: 'wrong' }, /Expected value.*wrong.*initial/],
    [{ action: 'click', selector: '#disabled' }, /disabled/],
  ] satisfies Array<[PreviewStep, RegExp]>)(
    'reports actionable step failure and stops: %j',
    async (step, reason) => {
      writeFileSync(
        join(tempDir, 'failure.html'),
        '<!doctype html><h1 id="title">Ready</h1><input id="field" value="initial"><button id="disabled" disabled>Disabled</button><button id="other">Other</button>',
        'utf8',
      );
      const result = await runPreview({
        path: 'failure.html',
        vision: false,
        workspaceRoot: tempDir,
        steps: [step, { action: 'assert', selector: '#title', text: 'Ready' }],
      });
      expect(result.ok).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps?.[0]).toMatchObject({
        index: 0,
        action: step.action,
        selector: step.selector,
        ok: false,
      });
      expect(result.steps?.[0]?.reason).toMatch(reason);
      expect(result.reason).toContain('Step 1');
      expect(result.visibleText).toContain('Ready');
      expect(result.metrics.nodes).toBeGreaterThan(0);
    },
    30_000,
  );

  it('uses real Tab/Escape keyboard events and captures the final screenshot', async () => {
    writeFileSync(
      join(tempDir, 'keyboard.html'),
      `<!doctype html><input id="first"><button id="second" onfocus="document.getElementById('state').textContent='Second focused'">Second</button><p id="state">Ready</p><script>document.addEventListener('keydown', event => {if(event.key === 'Escape') document.getElementById('state').textContent = 'Escaped';});</script>`,
      'utf8',
    );
    const result = await runPreview({
      path: 'keyboard.html',
      vision: true,
      workspaceRoot: tempDir,
      viewport: { width: 400, height: 700 },
      steps: [
        { action: 'press', selector: '#first', key: 'Tab' },
        { action: 'assert', selector: '#state', text: 'Second focused' },
        { action: 'press', selector: '#second', key: 'Escape' },
        { action: 'assert', selector: '#state', text: 'Escaped' },
      ],
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.visibleText).toContain('Escaped');
    const png = Buffer.from(result.screenshot?.split(',')[1] ?? '', 'base64');
    expect(png.readUInt32BE(16)).toBe(400);
    expect(png.readUInt32BE(20)).toBe(700);
  }, 30_000);

  it('waits briefly for asynchronous React changes without network-idle waits', async () => {
    writeFileSync(
      join(tempDir, 'Delayed.jsx'),
      `function App() { const [ready,setReady]=React.useState(false); return <main><button id="start" onClick={() => setTimeout(() => setReady(true), 250)}>Start</button>{ready && <p id="ready">Updated</p>}</main>; }`,
      'utf8',
    );
    const result = await runPreview({
      path: 'Delayed.jsx',
      vision: false,
      workspaceRoot: tempDir,
      steps: [
        { action: 'click', selector: '#start' },
        { action: 'assert', selector: '#ready', text: 'Updated' },
      ],
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.visibleText).toContain('Updated');
  }, 30_000);

  it('retains runtime errors raised by interactions', async () => {
    writeFileSync(
      join(tempDir, 'interaction-error.html'),
      '<!doctype html><button id="boom" onclick="throw new Error(\'interaction boom\')">Break</button>',
      'utf8',
    );
    const result = await runPreview({
      path: 'interaction-error.html',
      vision: false,
      workspaceRoot: tempDir,
      steps: [{ action: 'click', selector: '#boom' }],
    });
    expect(result.ok).toBe(false);
    expect(result.consoleErrors.some((error) => error.message.includes('interaction boom'))).toBe(
      true,
    );
    expect(result.visibleText).toContain('Break');
  }, 30_000);

  it('blocks document navigation while allowing same-document hash routing', async () => {
    writeFileSync(
      join(tempDir, 'navigation.html'),
      '<!doctype html><a id="hash" href="#details">Details</a><button id="leave" onclick="location.href=\'https://example.com/outside\'">Leave</button>',
      'utf8',
    );
    const result = await runPreview({
      path: 'navigation.html',
      vision: false,
      workspaceRoot: tempDir,
      steps: [
        { action: 'click', selector: '#hash' },
        { action: 'click', selector: '#leave' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.steps?.[0]?.ok).toBe(true);
    expect(result.steps?.[1]?.ok).toBe(false);
    expect(result.reason).toContain('Navigation outside');
    expect(result.visibleText).toContain('Details');
  }, 30_000);

  it.each([
    [{ action: 'click', selector: '#download' }, /Downloads are not allowed/],
    [{ action: 'press', selector: '#external-form', key: 'Enter' }, /Navigation outside/],
  ] satisfies Array<[PreviewStep, RegExp]>)(
    'refuses downloads and new form windows: %j',
    async (step, reason) => {
      writeFileSync(
        join(tempDir, 'external-actions.html'),
        '<!doctype html><a id="download" href="#file" download="file.txt">Download</a><form target="_blank" action="https://example.com"><input id="external-form"></form>',
        'utf8',
      );
      const result = await runPreview({
        path: 'external-actions.html',
        vision: false,
        workspaceRoot: tempDir,
        steps: [step],
      });
      expect(result.ok).toBe(false);
      expect(result.steps?.[0]?.reason).toMatch(reason);
      expect(result.visibleText).toContain('Download');
    },
    30_000,
  );

  it.each([
    ['cancellation', "console.log('cancel-now')", /cancelled/],
    ['hung interaction', 'while (true) {}', /timed out/],
    ['assertion failure', '', /Missing selector/],
  ])(
    'closes its own browser and profile after %s',
    async (scenario, handler, reason) => {
      const puppeteer = (await import('puppeteer-core')).default;
      const launch = puppeteer.launch.bind(puppeteer);
      const controller = new AbortController();
      const browsers: Awaited<ReturnType<typeof launch>>[] = [];
      const profiles: string[] = [];
      const spy = vi.spyOn(puppeteer, 'launch').mockImplementation(async (options) => {
        const browser = await launch(options);
        browsers.push(browser);
        if (options?.userDataDir) profiles.push(options.userDataDir);
        const newPage = browser.newPage.bind(browser);
        vi.spyOn(browser, 'newPage').mockImplementation(async () => {
          const page = await newPage();
          page.on('console', (message) => {
            if (message.text() === 'cancel-now') controller.abort();
          });
          return page;
        });
        return browser;
      });
      try {
        writeFileSync(
          join(tempDir, 'cancel.html'),
          `<!doctype html><button id="cancel" onclick="${handler}">Cancel</button>`,
          'utf8',
        );
        const start = Date.now();
        const result = await runPreview({
          path: 'cancel.html',
          vision: false,
          workspaceRoot: tempDir,
          signal: controller.signal,
          steps:
            scenario === 'assertion failure'
              ? [{ action: 'assert', selector: '#missing', visible: true }]
              : [{ action: 'click', selector: '#cancel' }],
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(reason);
        expect(Date.now() - start).toBeLessThan(20_000);
        expect(browsers).toHaveLength(1);
        expect(browsers[0]?.connected).toBe(false);
        expect(profiles).toHaveLength(1);
        expect(profiles.every((profile) => !existsSync(profile))).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
    30_000,
  );

  it('captures console errors from the rendered page', async () => {
    const file = join(tempDir, 'boom.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><h1>Hi</h1><script>console.error("boom");</script></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'boom.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.consoleErrors.some((e) => /boom/.test(e.message))).toBe(true);
    expect(result.metrics.nodes).toBeGreaterThan(0);
  }, 30_000);

  it('returns a DOM outline (not a screenshot) when vision=false', async () => {
    const file = join(tempDir, 'plain.html');
    writeFileSync(
      file,
      '<!doctype html><html><body><main><section><p>A</p></section></main></body></html>',
      'utf8',
    );
    const result = await runPreview({
      path: 'plain.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.screenshot).toBeUndefined();
    expect(typeof result.domOutline).toBe('string');
    expect((result.domOutline ?? '').length).toBeGreaterThan(0);
  }, 30_000);

  it('resolves relative scripts from HTML files against the workspace', async () => {
    writeFileSync(
      join(tempDir, 'relative.html'),
      '<!doctype html><html><body><div id="root"></div><script src="./relative.js"></script></body></html>',
      'utf8',
    );
    writeFileSync(
      join(tempDir, 'relative.js'),
      'document.getElementById("root").innerHTML = "<main id=\\"relative-root\\">Relative</main>";',
      'utf8',
    );
    const result = await runPreview({
      path: 'relative.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#relative-root');
  }, 30_000);

  it('renders standalone JSX files through the preview runtime', async () => {
    writeFileSync(
      join(tempDir, 'App.jsx'),
      'function App() { return <main id="jsx-root">Hello JSX</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'App.jsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#jsx-root');
  }, 30_000);

  it('renders JSX saved as HTML when it uses vendored runtime components', async () => {
    writeFileSync(
      join(tempDir, 'RuntimeFrame.html'),
      [
        'function App() {',
        '  return <IOSDevice><main id="runtime-frame-root">Inside iOS frame</main></IOSDevice>;',
        '}',
        'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);',
      ].join('\n'),
      'utf8',
    );
    const result = await runPreview({
      path: 'RuntimeFrame.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.metrics.nodes).toBeGreaterThan(20);
  }, 30_000);

  it('renders mixed HTML + inline JSX without relying on user-added CDN runtimes', async () => {
    writeFileSync(
      join(tempDir, 'Mixed.html'),
      [
        '<!doctype html><html><head>',
        '<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js"></script>',
        '<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"></script>',
        '</head><body><div id="root"></div>',
        '<script>function App() { return <main id="mixed-jsx-root">Mixed JSX</main>; } ReactDOM.createRoot(document.getElementById("root")).render(<App/>);</script>',
        '</body></html>',
      ].join('\n'),
      'utf8',
    );
    const result = await runPreview({
      path: 'Mixed.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#mixed-jsx-root');
  }, 30_000);

  it('does not follow source-reference-looking strings inside JSX files', async () => {
    writeFileSync(
      join(tempDir, 'Marker.jsx'),
      'const marker = "<!-- artifact source lives in missing.jsx -->";\nfunction App() { return <main id="marker-root">{marker}</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'Marker.jsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#marker-root');
  }, 30_000);

  it('renders placeholder HTML files through their referenced JSX source', async () => {
    writeFileSync(
      join(tempDir, 'index.html'),
      '<!doctype html><html><body><!-- artifact source lives in index.jsx --></body></html>',
      'utf8',
    );
    writeFileSync(
      join(tempDir, 'index.jsx'),
      'function App() { return <main id="placeholder-jsx-root">Placeholder JSX</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'index.html',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#placeholder-jsx-root');
  }, 30_000);

  it('renders standalone TSX files through the preview runtime', async () => {
    writeFileSync(
      join(tempDir, 'App.tsx'),
      'function App(): JSX.Element { const label: string = "Hello TSX"; return <main id="tsx-root">{label}</main>; }',
      'utf8',
    );
    const result = await runPreview({
      path: 'App.tsx',
      vision: false,
      workspaceRoot: tempDir,
    });
    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.domOutline).toContain('main#tsx-root');
  }, 30_000);
});
