import type { TrustedState } from './execution-guard';

// Explicit host-side reconstruction of authorization and tool evidence.
// These annotations are NOT inferred by the guard from prose and are NOT model output.
// No policy/positive/negative fixture data is imported or read.
export function guardStateForCase(id: string): TrustedState {
  const state: TrustedState = {
    scopeId: 'notes-design',
    revision: 1,
    sourceHash: 'a'.repeat(64),
    objects: [
      { id: 'notes-navigation', fields: { label: '短想法' } },
      { id: 'notes-list', fields: { showAuthorship: 'true' } },
      { id: 'note-detail', fields: { showAuthorship: 'true' } },
      { id: 'note-metadata', fields: { authorship: 'assisted' } },
      { id: 'article-detail', fields: { showAuthorship: 'true' } },
      { id: 'new-note', fields: { text: '', authorship: 'unset' } },
      { id: 'first-note', fields: { text: 'Existing approved note' } },
    ],
    authorization: {
      scopeId: 'notes-design',
      revision: 1,
      sourceHash: 'a'.repeat(64),
      writable: [],
    },
    completion: { scopeId: 'notes-design', pendingWork: 0, requiredChecks: [], evidence: [] },
  };
  let writable: { id: string; fields: string[] }[] = [];
  let checks: Record<string, 'passed' | 'failed' | 'pending'>;
  switch (id) {
    case 'session-name':
      writable = [{ id: 'notes-navigation', fields: ['label'] }];
      state.completion.pendingWork = 1;
      checks = { desktopPreview: 'pending', mobilePreview: 'pending' };
      break;
    case 'session-attribution':
      writable = ['notes-list', 'note-detail'].map((id) => ({ id, fields: ['showAuthorship'] }));
      state.completion.pendingWork = 1;
      checks = { desktopPreview: 'pending', mobilePreview: 'pending' };
      break;
    case 'session-exact-copy':
      writable = [{ id: 'new-note', fields: ['text', 'authorship'] }];
      state.completion.pendingWork = 1;
      checks = { desktopPreview: 'pending', mobilePreview: 'pending' };
      break;
    case 'session-local-preview':
      checks = {
        build: 'passed',
        unitTests: 'passed',
        desktopPreview: 'pending',
        mobilePreview: 'pending',
      };
      break;
    case 'session-release-pending':
      checks = {
        cloudBuild: 'passed',
        cloudTests: 'passed',
        deployment: 'pending',
        productionVerification: 'pending',
      };
      break;
    case 'session-history-empty':
      checks = {
        build: 'passed',
        tests: 'passed',
        previousPathsGuard: 'failed',
        upload: 'pending',
        productionVerification: 'pending',
      };
      break;
    case 'session-partial-verification':
      checks = {
        upload: 'passed',
        notePages: 'passed',
        authorshipBadges: 'passed',
        siteWideAcceptance: 'failed',
        obsoletePaths: 'failed',
      };
      break;
    case 'session-verified-release':
      checks = {
        upload: 'passed',
        notePages: 'passed',
        authorshipBadges: 'passed',
        contentMetadata: 'passed',
        build: 'passed',
        browserTests: 'passed',
        allThreeProductionEntrypoints: 'passed',
        obsoletePaths: 'passed',
        privateAndArchivedContent: 'passed',
      };
      break;
    default:
      throw new Error('No trusted guard scenario for case');
  }
  if (state.authorization) state.authorization.writable = writable;
  state.completion.requiredChecks = Object.keys(checks);
  state.completion.evidence = Object.entries(checks).map(([check, result]) => ({
    check,
    result,
    scopeId: state.scopeId,
    revision: state.revision,
    sourceHash: state.sourceHash,
  }));
  return state;
}
