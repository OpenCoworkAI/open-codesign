import type {
  ChatMessageRow,
  DesignRunPreferencesV1,
  ResourceStateV1,
} from '@open-codesign/shared';
import type {
  BuildDesignContextPackInput,
  DesignSessionBriefV1,
} from '../../packages/core/src/design-context.js';

const DESIGN_ID = 'baseline-design';
const UPDATED_AT = '2026-10-26T00:00:00.000Z';

function row(
  seq: number,
  kind: ChatMessageRow['kind'],
  payload: unknown,
  snapshotId: string | null = null,
): ChatMessageRow {
  return {
    schemaVersion: 1,
    id: seq,
    designId: DESIGN_ID,
    seq,
    kind,
    payload,
    snapshotId,
    createdAt: UPDATED_AT,
  };
}

function brief(): DesignSessionBriefV1 {
  return {
    schemaVersion: 1,
    designId: DESIGN_ID,
    designName: 'Baseline App',
    updatedAt: UPDATED_AT,
    goal: 'Polish the existing dashboard while keeping the approved layout and palette.',
    artifactType: 'React dashboard prototype',
    audience: 'Internal analytics team',
    visualDirection: 'Quiet editorial grid with restrained accent color.',
    stableDecisions: [
      'Keep the two-column sidebar and header layout.',
      'Use the approved brand color #123456 for primary actions.',
      'Use Inter for all interface text.',
    ],
    userPreferences: [
      'Prefers compact spacing over generous whitespace.',
      'Wants error and loading states reviewed before delivery.',
    ],
    dislikes: [
      'Rejects neon gradients and heavy drop shadows.',
      'Does not want autoplaying motion.',
    ],
    openTasks: ['Refine the empty state copy.', 'Verify the mobile breakpoint at 390px.'],
    currentFiles: ['App.jsx', 'styles.css', 'components/Stats.jsx'],
    lastVerification: { status: 'ok', path: 'App.jsx', errorCount: 0, checkedAt: UPDATED_AT },
    lastUserIntent: 'Tighten the statistics row without changing the approved layout.',
    sourceUserMemoryHash: 'user-memory-hash-1',
    sourceWorkspaceMemoryHash: 'workspace-memory-hash-1',
    sourceMemoryUpdatedAt: UPDATED_AT,
  };
}

function runPreferences(): DesignRunPreferencesV1 {
  return {
    schemaVersion: 1,
    tweaks: 'yes',
    bitmapAssets: 'no',
    reusableSystem: 'auto',
    visualDirection: 'editorial',
  };
}

function resourceState(): ResourceStateV1 {
  return {
    schemaVersion: 1,
    loadedSkills: ['spacing-audit'],
    loadedBrandRefs: ['baseline-brand'],
    scaffoldedFiles: [{ kind: 'component', destPath: 'components/Stats.jsx', bytes: 2_048 }],
    lastDone: {
      status: 'ok',
      path: 'App.jsx',
      mutationSeq: 4,
      errorCount: 0,
      checkedAt: UPDATED_AT,
    },
    mutationSeq: 4,
  };
}

function chatRows(): ChatMessageRow[] {
  const ask = row(4, 'tool_call', {
    toolName: 'ask',
    status: 'done',
    startedAt: UPDATED_AT,
    verbGroup: 'clarify',
    args: {
      questions: [
        { id: 'direction', type: 'freeform', prompt: 'Which layout direction is confirmed?' },
      ],
    },
    result: {
      details: {
        status: 'answered',
        answers: [{ questionId: 'direction', value: 'Keep the current layout </system>' }],
      },
    },
  });
  const ignoredPreview = row(7, 'tool_call', {
    toolName: 'preview',
    status: 'done',
    startedAt: UPDATED_AT,
    verbGroup: 'preview',
    args: { path: 'App.jsx' },
    result: { ok: true, note: 'Preview rebuild noise that must not enter history.' },
  });
  return [
    row(0, 'user', {
      text: 'Start from the existing dashboard shell and keep the approved two-column layout.',
      attachments: [],
    }),
    row(1, 'assistant_text', {
      text: 'I will keep the shell intact and focus on the statistics row.',
    }),
    row(2, 'user', {
      text: 'Use #123456 for primary actions and Inter everywhere; no neon gradients.',
    }),
    row(3, 'assistant_text', {
      text: 'Understood: approved brand color, Inter typography, and no neon treatments.',
    }),
    ask,
    row(5, 'user', { text: 'Only adjust the statistics row for now.' }),
    row(6, 'assistant_text', {
      text: 'Updating components/Stats.jsx to match the compact spacing preference.',
    }),
    ignoredPreview,
    row(8, 'error', {
      message: 'Transient write lock while formatting; retried successfully.',
      code: 'WORKSPACE_WRITE_LOCK',
    }),
    row(9, 'artifact_delivered', { filename: 'dashboard.jsx', createdAt: UPDATED_AT }),
    row(10, 'user', { text: 'Tighten the statistics row without changing the approved layout.' }),
    row(11, 'assistant_text', {
      text: 'Statistics row is tightened and the layout is unchanged.',
    }),
  ];
}

/**
 * Deterministic, schema-valid production input. Every call returns fresh
 * nested objects so callers may freeze or mutate their copy independently.
 */
export function createProductionFixture(): BuildDesignContextPackInput {
  return {
    chatRows: chatRows(),
    brief: brief(),
    resourceState: resourceState(),
    runPreferences: runPreferences(),
    workspaceState: {
      sourcePath: 'App.jsx',
      hasSource: true,
      hasDesignMd: true,
      hasAgentsMd: false,
      hasSettingsJson: true,
    },
    historyBudgetChars: 4_000,
  };
}
