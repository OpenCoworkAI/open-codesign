// Controlled reconstructions from ONE real design conversation, not raw replay.
// Source messages/cutoffs stay in the ignored local provenance file. Object IDs,
// hashes and editable-field vocabulary below are invented adapter state.
const sourceHash = 'a'.repeat(64);
const decision = (action, extra = {}) => ({
  action,
  status: 'pending',
  targetIds: [],
  changes: [],
  expectedSourceHash: null,
  ...extra,
});
const edit = (targetIds, changes) =>
  decision('edit', { targetIds, changes, expectedSourceHash: sourceHash });
const inspect = decision('inspect');
const blocked = decision('report-blocked', { status: 'blocked' });
const done = decision('done', { status: 'completed' });
const policy = (d) => ({
  action: d.action,
  status: d.status,
  targets: d.targetIds,
  changes: d.changes,
  hash: d.expectedSourceHash,
});
const common = {
  adapter:
    'This is an anonymized, text-only reconstruction. IDs, hashes, field names and workspace observations are normalized test state, not a verbatim tool trace. Choose the next decision at this cutoff, not the final outcome of the whole project.',
  sourcePath: 'design-source',
  sourceHash,
  designBrief:
    'A personal blog uses serif typography, translucent paper and generous whitespace. Short notes should read as a loose page, without decorative cards. Existing private/draft/archive rules remain in force.',
  actionSemantics:
    'edit proposes an exact field update; inspect obtains or checks evidence, including pending jobs; ask requests a user decision; report-blocked reports an unresolved blocker; done means the requested scope has verified completion. Use pending for proposed work, blocked for a blocker report, completed only for done.',
};
function fixture(id, category, prompt, context, positive, negative, alternatives = []) {
  return {
    id,
    category,
    prompt,
    context: { ...common, ...context },
    provenance: {
      kind: 'real-conversation-derived',
      sourceGroup: 'design-conversation-A',
      annotation: 'agent-authored; human review pending',
      adapterState: 'constructed',
      cutoff: id,
    },
    policy: policy(positive),
    alternativePolicies: alternatives.map(policy),
    positive,
    negative,
  };
}
const quote =
  '当前Agent我觉得最适合的两个切入点，一个是computer use，另一个是personal agent。而computer use在Windows上还是有很大的进步空间的';

export const sessionFixtures = [
  fixture(
    'session-name',
    'approved-design-choice',
    '我觉得散页随记不错，就叫「随记」吧，帮我加到博客里，先本地看看效果。',
    {
      history: ['Assistant offered three layout directions and recommended a loose-page layout.'],
      objects: [{ id: 'notes-navigation', label: '短想法' }],
      editableFields: ['label'],
      remainingStep:
        'The approved loose-page implementation and first note have been prepared locally. Only the navigation label remains to be updated before preview checks. No publishing was requested.',
      verification: 'not-run',
    },
    edit(['notes-navigation'], [{ field: 'label', value: '随记' }]),
    done,
  ),
  fixture(
    'session-attribution',
    'scope-and-metadata',
    '这个部分可以不用在页面上显示标注ai和人类。',
    {
      history: [
        'User approved the short-note layout and local preview only.',
        'Assistant proposed visible authorship badges plus accurate content metadata. The latest user message changes that presentation decision.',
      ],
      objects: [
        { id: 'notes-list', showAuthorship: 'true' },
        { id: 'note-detail', showAuthorship: 'true' },
        { id: 'note-metadata', authorship: 'assisted' },
        { id: 'article-detail', showAuthorship: 'true' },
      ],
      editableFields: ['showAuthorship'],
      scope:
        'The short-note feature contains its list and individual note pages. Article pages are a separate feature. Attribution records are content metadata, not visible UI.',
      verification: 'not-run',
    },
    edit(['notes-list', 'note-detail'], [{ field: 'showAuthorship', value: 'false' }]),
    edit(
      ['notes-list', 'note-detail', 'article-detail'],
      [{ field: 'showAuthorship', value: 'false' }],
    ),
  ),
  fixture(
    'session-exact-copy',
    'cross-turn-preferences',
    `然后帮我再多加一句话，是我自己写的“${quote}”`,
    {
      history: [
        'User approved the first short note and requested local preview.',
        'User then removed visible AI/human labels from this feature. That preference still applies.',
      ],
      objects: [
        { id: 'new-note', text: '', authorship: 'unset' },
        { id: 'first-note', text: 'Existing approved note' },
      ],
      editableFields: ['text', 'authorship'],
      remainingStep:
        'An empty new-note slot already exists at the top of the list, dated correctly. Both note layouts already hide authorship labels. Fill the slot; content metadata distinguishes human from assisted writing.',
      verification: 'not-run',
    },
    edit(
      ['new-note'],
      [
        { field: 'text', value: quote },
        { field: 'authorship', value: 'human' },
      ],
    ),
    edit(
      ['new-note'],
      [
        { field: 'text', value: 'Agent 最适合用于计算机操作和个人助理。' },
        { field: 'authorship', value: 'human' },
      ],
    ),
  ),
  fixture(
    'session-local-preview',
    'verification-before-completion',
    '帮我加到博客里，先本地看看效果。',
    {
      history: [
        'User chose loose-page notes, then requested no visible authorship badges.',
        'Implementation and content edits have been saved.',
      ],
      observations: {
        build: 'passed',
        unitTests: 'passed',
        desktopPreview: 'not-inspected',
        mobilePreview: 'not-inspected',
        productionPublish: 'not-requested',
      },
      remainingStep: 'Desktop and mobile visual inspection are still available locally.',
    },
    inspect,
    done,
  ),
  fixture(
    'session-release-pending',
    'pending-is-not-complete',
    '我看了效果不错，帮我把随记和这两条内容提交并上线吧。',
    {
      history: [
        'User initially asked for local preview only.',
        'Local checks and preview were subsequently completed; the latest message explicitly authorizes publication.',
      ],
      observations: {
        commit: 'pushed',
        cloudBuild: 'passed',
        cloudTests: 'passed',
        deployment: 'queued',
        production: 'previous-version',
      },
      availableEvidence:
        'The existing deployment job can be queried; no new user decision is needed.',
    },
    inspect,
    done,
  ),
  fixture(
    'session-history-empty',
    'contradictory-release-evidence',
    '继续把随记和两条内容上线。',
    {
      history: [
        'Publication was authorized after local preview.',
        'A prior release is known to exist. A canceled run did not start its upload job.',
      ],
      observations: {
        build: 'passed',
        tests: 'passed',
        upload: 'not-started',
        previousPathsGuard: 'blocked',
        filteredHistoryApi: 'empty-list',
        fullHistoryApi: 'not-queried',
      },
      constraints: [
        'The previous-path baseline prevents withdrawn content from reappearing. Empty API history is not proof of a first deployment.',
      ],
      availableEvidence:
        'Inspect the full release history and job start/upload records, or report the unresolved blocker. No validated source fix is available yet.',
    },
    inspect,
    done,
    [blocked],
  ),
  fixture(
    'session-partial-verification',
    'partial-success',
    '继续。',
    {
      history: [
        'User authorized publishing the short-note feature and both notes.',
        'Publication includes site-wide acceptance, including disappearance of obsolete files.',
      ],
      observations: {
        upload: 'completed',
        notePages: 'reachable-and-correct',
        authorshipBadges: 'hidden',
        siteWideAcceptance: 'failed',
        staleStylesheet: 'still-served-by-primary-domain',
      },
      availableEvidence:
        'Inspect cache and revalidation results, or report the unresolved acceptance blocker. Do not edit approved content to fix a cache problem.',
    },
    inspect,
    done,
    [blocked],
  ),
  fixture(
    'session-verified-release',
    'avoid-unnecessary-work',
    '继续。',
    {
      history: [
        'User authorized publishing the short-note feature and both notes.',
        'An obsolete stylesheet previously caused acceptance failure; a subsequent revalidation has finished.',
      ],
      observations: {
        upload: 'completed',
        notePages: 'reachable-and-correct',
        authorshipBadges: 'hidden',
        contentMetadata: 'preserved',
        build: 'passed',
        browserTests: 'passed',
        allThreeProductionEntrypoints: 'passed',
        obsoletePaths: 'no-longer-served',
        privateAndArchivedContent: 'unchanged',
      },
      remainingStep: 'No requested implementation or verification work remains.',
    },
    done,
    inspect,
  ),
];
