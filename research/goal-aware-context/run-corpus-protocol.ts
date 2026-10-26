import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CompleteModelInput, estimateUtf8QuarterTokens, measureRequest } from './budget.js';
import {
  COMPARISON_PROTOCOL,
  createCorpusInput,
  freezeContext,
  getCompressorInput,
  parseCorpus,
  reuseContext,
  validateManifest,
} from './corpus.js';
import { parseEvaluation } from './evaluation.js';
import { buildProductionBaseline } from './production-baseline.js';

function read(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
}

export function createCorpusProtocolReport() {
  const sessions = parseCorpus(read('./corpus-inputs.json'));
  const evaluation = parseEvaluation(read('./corpus-evaluation.json'), sessions);
  const manifest = validateManifest(sessions, read('./corpus-manifest.json'), evaluation);
  const cases = sessions.flatMap((session) =>
    session.checkpoints.map((checkpoint) => {
      const input = createCorpusInput(session, checkpoint.id);
      // Freeze before accessing questions. No question, answer, label or next-edit task enters this call.
      const pack = buildProductionBaseline(getCompressorInput(input));
      const frozen = freezeContext(input, 'production-raw@1', JSON.stringify(pack));
      const reference = evaluation.cases.find((entry) => entry.caseId === checkpoint.id);
      const entry = manifest.cases.find((entry) => entry.caseId === checkpoint.id);
      if (!reference || !entry) throw new Error('Missing frozen case');
      const questionMeasurements = reference.questions.map((question) => {
        reuseContext(frozen, input, 'production-raw@1');
        const request: CompleteModelInput = {
          systemPrompt:
            'Protocol smoke fixture: answer the requested key using the supplied design context.',
          contextSections: pack.contextSections,
          messages: pack.history,
          tools: [
            {
              name: 'edit',
              description: 'Edit a scoped workspace file.',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' }, content: { type: 'string' } },
                required: ['path', 'content'],
              },
            },
          ],
          question: question.text,
        };
        return {
          key: question.key,
          measurements: COMPARISON_PROTOCOL.inputBudgetTokens.map((inputBudgetTokens) => ({
            inputBudgetTokens,
            ...measureRequest(
              request,
              {
                inputBudgetTokens,
                contextWindowTokens: 32768,
                reservedOutputTokens: COMPARISON_PROTOCOL.reservedOutputTokens,
              },
              estimateUtf8QuarterTokens,
            ),
          })),
        };
      });
      return {
        caseId: checkpoint.id,
        split: entry.split,
        inputHash: frozen.inputHash,
        contextHash: frozen.contextHash,
        cutoffSeq: input.cutoffSeq,
        prefixRows: input.contextInput.chatRows.length,
        workspaceRevision: input.workspaceRevision,
        productionTrace: pack.trace,
        questionMeasurements,
        withinEstimateTiers: COMPARISON_PROTOCOL.inputBudgetTokens.filter((limit) =>
          questionMeasurements.every((question) =>
            question.measurements.some(
              (m) => m.inputBudgetTokens === limit && m.status === 'within-budget',
            ),
          ),
        ),
      };
    }),
  );
  return {
    schemaVersion: 1,
    kind: 'synthetic-corpus-protocol-audit',
    nodeVersion: process.version,
    modelCalls: 0,
    budgetStatus: 'estimate-only; synthetic request framing; not actual model input tokens',
    manifest,
    protocol: COMPARISON_PROTOCOL,
    summary: {
      sessions: sessions.length,
      checkpoints: cases.length,
      questions: evaluation.cases.reduce((sum, entry) => sum + entry.questions.length, 0),
      rows: sessions.reduce((sum, session) => sum + session.rows.length, 0),
    },
    cases,
  };
}

function main(): void {
  const output = resolve(
    process.argv[2] ?? '.Codex/workspace/goal-aware-context/corpus-protocol-audit.json',
  );
  const report = createCorpusProtocolReport();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${output}\n`);
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
