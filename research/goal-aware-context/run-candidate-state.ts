import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAnnotationDrafts, syntheticToolRevision } from './annotation-drafts.js';
import { estimateUtf8QuarterTokens } from './budget.js';
import { buildCandidatePack } from './candidate-pack.js';
import {
  COMPARISON_PROTOCOL,
  createCorpusInput,
  freezeContext,
  getCompressorInput,
  hashJson,
  parseCorpus,
  reuseContext,
} from './corpus.js';

function read(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
}
export function createCandidateStateReport() {
  // No evaluator references/questions/answers are loaded by this runner.
  const sessions = parseCorpus(read('./corpus-inputs.json'));
  const manifest = read('./corpus-manifest.json');
  const drafts = parseAnnotationDrafts(read('./annotation-drafts.json'), sessions, manifest);
  const annotationHash = hashJson(drafts);
  const implementationFiles = [
    './goal-state.ts',
    './candidate-pack.ts',
    './budget.ts',
    './production-baseline.ts',
    './corpus.ts',
    './annotation-drafts.ts',
    './run-candidate-state.ts',
    '../../packages/core/src/design-context.ts',
    '../../packages/core/src/lib/context-format.ts',
    '../../packages/core/src/memory.ts',
    '../../packages/shared/src/resource-manifest.ts',
    '../../packages/shared/src/snapshot.ts',
    '../../packages/shared/src/index.ts',
    '../../pnpm-lock.yaml',
  ];
  const implementationHash = hashJson(
    Object.fromEntries(
      implementationFiles.map((path) => [
        path,
        readFileSync(new URL(path, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const conditions = drafts.cases.flatMap((entry) => {
    const session = sessions.find((s) => s.checkpoints.some((cp) => cp.id === entry.caseId));
    if (!session) throw new Error('Missing development session');
    const input = createCorpusInput(session, entry.caseId);
    const scope = {
      records: entry.records,
      designId: input.designId,
      cutoffSeq: input.cutoffSeq,
      currentRevision: syntheticToolRevision(input.workspaceRevision),
    };
    return COMPARISON_PROTOCOL.inputBudgetTokens.map((inputBudgetTokens) => {
      const settings = {
        limits: { inputBudgetTokens, contextWindowTokens: 32768, reservedOutputTokens: 1024 },
        readerReserveTokens: 256,
        systemPrompt:
          'Offline state-selection fixture. Preserve active constraints; ask about unresolved conflicts.',
        tools: [],
      };
      const conditionId = `draft-oracle-state@1:${hashJson({
        annotationHash,
        implementationHash,
        scope,
        settings,
        counterId: estimateUtf8QuarterTokens.id,
      })}`;
      const result = buildCandidatePack(getCompressorInput(input), scope, {
        ...settings,
        counter: estimateUtf8QuarterTokens,
      });
      const frozen = freezeContext(input, conditionId, JSON.stringify(result.pack));
      reuseContext(frozen, input, conditionId);
      return { caseId: entry.caseId, inputBudgetTokens, conditionId, result, frozen };
    });
  });
  return {
    schemaVersion: 1,
    kind: 'draft-oracle-state-audit',
    nodeVersion: process.version,
    modelCalls: 0,
    humanReview: 'pending',
    annotationHash,
    implementationHash,
    manifestHash: hashJson(manifest),
    measurement: 'estimate-only, question-reserved preflight; no reader evaluation',
    selectionCondition:
      'privileged draft annotations; not natural-language end-to-end or a fair model-quality comparison',
    annotationRecords: drafts.cases.reduce((sum, c) => sum + c.records.length, 0),
    conditions,
  };
}
function main(): void {
  const output = resolve(
    process.argv[2] ?? '.Codex/workspace/goal-aware-context/candidate-state-audit.json',
  );
  const report = createCandidateStateReport();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${output}\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
