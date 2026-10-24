import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSourceEdit, planSourceEdit } from '../../apps/desktop/src/main/source-edit-engine';
import { planScopedEdit, type SelectionGrant } from './scoped-edit';

type Request = Parameters<typeof planSourceEdit>[0];
const source =
  'function App() { return <main><h1 style={{ color: "red" }}>Hello</h1><footer>Hello</footer></main>; }';

function fixture(input = source) {
  const inspected = analyzeSourceEdit({ path: 'App.jsx', source: input });
  if (inspected.status !== 'ready') throw new Error(inspected.reason);
  const title = inspected.targets.find((item) => item.tagName === 'h1');
  const footer = inspected.targets.find((item) => item.tagName === 'footer');
  if (!title || !footer) throw new Error('Fixture must contain both targets');
  const grant: SelectionGrant = {
    path: 'App.jsx',
    sourceHash: inspected.sourceHash,
    targetIds: [title.id],
    fields: ['text:only'],
  };
  const request: Request = {
    path: 'App.jsx',
    source: input,
    expectedSourceHash: inspected.sourceHash,
    targetId: title.id,
    operation: { kind: 'set-text', value: 'Welcome' },
    scope: 'source-definition',
  };
  return { grant, request, footer };
}

const cases: {
  id: string;
  setup: () => ReturnType<typeof fixture>;
  expected: 'applied' | 'rejected';
  baseline: 'applied' | 'rejected';
}[] = [
  {
    id: 'identical-source-in-another-file',
    setup: () => {
      const f = fixture();
      f.request.path = 'Other.jsx';
      return f;
    },
    expected: 'rejected',
    baseline: 'applied',
  },
  { id: 'selected-title', setup: () => fixture(), expected: 'applied', baseline: 'applied' },
  {
    id: 'same-label-outside-selection',
    setup: () => {
      const f = fixture();
      f.request.targetId = f.footer.id;
      return f;
    },
    expected: 'rejected',
    baseline: 'applied',
  },
  {
    id: 'valid-style-not-requested',
    setup: () => {
      const f = fixture();
      f.request.operation = { kind: 'set-style', property: 'color', value: 'blue' };
      return f;
    },
    expected: 'rejected',
    baseline: 'applied',
  },
  {
    id: 'authorized-style',
    setup: () => {
      const f = fixture();
      f.grant.fields = ['style:color'];
      f.request.operation = { kind: 'set-style', property: 'color', value: '#123456' };
      return f;
    },
    expected: 'applied',
    baseline: 'applied',
  },
  {
    id: 'external-write-after-selection',
    setup: () => {
      const f = fixture();
      f.request.source += '\n// external write';
      return f;
    },
    expected: 'rejected',
    baseline: 'rejected',
  },
  {
    id: 'fresh-request-with-old-grant',
    setup: () => {
      const f = fixture(`${source}\n// revision two`);
      f.grant.sourceHash = fixture().grant.sourceHash;
      return f;
    },
    expected: 'rejected',
    baseline: 'applied',
  },
  {
    id: 'unknown-target',
    setup: () => {
      const f = fixture();
      f.request.targetId = '999:1000';
      return f;
    },
    expected: 'rejected',
    baseline: 'rejected',
  },
  {
    id: 'empty-grant',
    setup: () => {
      const f = fixture();
      f.grant.targetIds = [];
      return f;
    },
    expected: 'rejected',
    baseline: 'applied',
  },
  {
    id: 'css-url-rejected-by-engine',
    setup: () => {
      const f = fixture();
      f.grant.fields = ['style:color'];
      f.request.operation = {
        kind: 'set-style',
        property: 'color',
        value: 'url(https://example.invalid)',
      };
      return f;
    },
    expected: 'rejected',
    baseline: 'rejected',
  },
  {
    id: 'runtime-marker-rejected-by-engine',
    setup: () => {
      const f = fixture();
      f.request.operation = { kind: 'set-text', value: 'ReactDOM.createRoot' };
      return f;
    },
    expected: 'rejected',
    baseline: 'rejected',
  },
  {
    id: 'dynamic-text-refused',
    setup: () => fixture(source.replace('>Hello</h1>', '>{Date.now()}</h1>')),
    expected: 'rejected',
    baseline: 'rejected',
  },
  {
    id: 'bom-and-crlf',
    setup: () => fixture(`\uFEFF// fixture 😀\r\n${source}\r\n`),
    expected: 'applied',
    baseline: 'applied',
  },
  {
    id: 'literal-markup-escaped',
    setup: () => {
      const f = fixture();
      f.request.operation = { kind: 'set-text', value: '<script>bad()</script>' };
      return f;
    },
    expected: 'applied',
    baseline: 'applied',
  },
  {
    id: 'removed-source-selection-mode',
    setup: () => {
      const f = fixture();
      f.request.selectionMode = 'source';
      return f;
    },
    expected: 'rejected',
    baseline: 'rejected',
  },
];

describe('scoped source-edit experiment against the actual mainline engine', () => {
  it.each(cases)('$id', ({ setup, expected, baseline }) => {
    const { grant, request } = setup();
    const before = structuredClone(request);
    expect(planSourceEdit(request).status).toBe(baseline);
    const result = planScopedEdit(grant, request);
    expect(result.status).toBe(expected);
    expect(request).toEqual(before);
    if (result.status === 'applied') {
      expect(result.content).toContain('<footer>Hello</footer>');
      expect(result.content.slice(0, result.patch.start)).toBe(
        request.source.slice(0, result.patch.start),
      );
      expect(result.content.slice(result.patch.start + result.patch.replacement.length)).toBe(
        request.source.slice(result.patch.end),
      );
      const again = analyzeSourceEdit({ path: 'App.jsx', source: result.content });
      expect(again.status).toBe('ready');
      if (again.status !== 'ready') throw new Error(again.reason);
      expect(again.targets.find((t) => t.tagName === 'h1')?.editableFields).toContainEqual(
        request.operation,
      );
    }
  });

  it('writes a reproducible observation table, without calling a model or writing an artifact', () => {
    const rows = cases.map(({ id, setup, expected }) => {
      const { grant, request } = setup();
      const baseline = planSourceEdit(request);
      const scoped = planScopedEdit(grant, request);
      return {
        id,
        expected,
        baseline: baseline.status,
        scoped: scoped.status,
        reason: scoped.status === 'rejected' ? scoped.reason : null,
      };
    });
    const report = {
      schemaVersion: 1,
      kind: 'synthetic-engine-integration',
      node: process.version,
      cases: rows.length,
      baselineMeetsIntent: rows.filter((r) => r.baseline === r.expected).length,
      scopedMeetsIntent: rows.filter((r) => r.scoped === r.expected).length,
      rows,
    };
    const output = resolve('.Codex/workspace/scoped-design-edits/results.json');
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    expect(report.scopedMeetsIntent).toBe(cases.length);
  });
});
