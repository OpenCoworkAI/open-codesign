import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { hashJson, parseCorpus, validateManifest } from './corpus.js';
import { parseEvaluation } from './evaluation.js';
import { loadUnifiedData } from './unified-plan.js';
import {
  parseScoringPolicy,
  type ScorableResponse,
  type ScoringPolicy,
  scoreQuestion,
  summarizeJudgments,
  validateScoringPolicy,
} from './unified-scoring.js';

interface Condition {
  id: string;
  caseId: string;
  method: string;
}
interface Observation {
  conditionId: string;
  group: string;
  status: string;
}
export function verifyRunFiles(directory: string, expected: Record<string, string>): void {
  for (const [name, hash] of Object.entries(expected)) {
    if (basename(name) !== name) throw new Error('Invalid historical artifact name');
    const actual = createHash('sha256')
      .update(readFileSync(resolve(directory, name)))
      .digest('hex');
    if (actual !== hash) throw new Error(`Historical artifact hash mismatch: ${name}`);
  }
}
export function rescoreCompression(
  evaluation: ReturnType<typeof parseEvaluation>,
  policy: ScoringPolicy,
  conditions: readonly Condition[],
  observations: readonly Observation[],
  calls: readonly ScorableResponse[],
) {
  const observed = observations.filter((row) => row.group === 'compression');
  if (
    new Set(conditions.map((c) => c.id)).size !== conditions.length ||
    observed.length !== conditions.length ||
    new Set(observed.map((row) => row.conditionId)).size !== conditions.length ||
    observed.some((row) => !conditions.some((c) => c.id === row.conditionId))
  )
    throw new Error('Compression condition coverage mismatch');
  if (new Set(calls.map((row) => row.id)).size !== calls.length)
    throw new Error('Duplicate historical response');
  const byId = new Map(calls.map((row) => [row.id, row]));
  const rescored = conditions.map((condition) => {
    const reference = evaluation.cases.find((row) => row.caseId === condition.caseId);
    const observation = observed.find((row) => row.conditionId === condition.id);
    if (!reference || !observation) throw new Error('Missing reference/observation');
    const questions = reference.questions.map((question) => {
      const call = byId.get(`${condition.id}/read/${question.key}`) ?? null;
      return scoreQuestion(
        policy,
        condition.caseId,
        question,
        call,
        observation.status === 'provider-overflow' || !call ? observation.status : 'ok',
      );
    });
    const correct = questions.filter((row) => row.success).length;
    return {
      ...condition,
      originalStatus: observation.status,
      correct,
      total: questions.length,
      allCorrect: correct === questions.length,
      questions,
    };
  });
  const questions = rescored.flatMap((row) => row.questions);
  const methods = [...new Set(rescored.map((row) => row.method))].map((method) => {
    const rows = rescored.filter((row) => row.method === method);
    return {
      method,
      ...summarizeJudgments(rows.flatMap((row) => row.questions)),
      allCorrectConditions: rows.filter((row) => row.allCorrect).length,
      conditions: rows.length,
    };
  });
  return {
    correct: questions.filter((row) => row.success).length,
    total: questions.length,
    questionMetrics: summarizeJudgments(questions),
    byMethod: methods,
    conditions: rescored,
  };
}
const conditionSchema = z.object({ id: z.string(), caseId: z.string(), method: z.string() });
const observationSchema = z.object({
  conditionId: z.string(),
  group: z.string(),
  status: z.string(),
});
const responseSchema = z.object({
  event: z.literal('response'),
  id: z.string(),
  requestHash: z.string(),
  status: z.string(),
  value: z.unknown(),
  raw: z.string().nullable(),
});
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const journal = (path: string): unknown[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

/** Offline only: no provider import, credentials, prompt rewriting, or historical artifact writes. */
export function deriveHistoricalReports(runsRoot: string, output: string) {
  const data = loadUnifiedData();
  const corpus = parseCorpus(data.corpus);
  const evaluation = parseEvaluation(data.evaluation, corpus);
  const manifest = validateManifest(corpus, data.manifest, evaluation);
  const policy = parseScoringPolicy(data.scoring);
  validateScoringPolicy(
    policy,
    evaluation,
    manifest.cases.filter((c) => c.split === 'development').map((c) => c.caseId),
  );
  const runs = Object.entries(policy.historicalSha256).map(([runId, hashes]) => {
    if (basename(runId) !== runId) throw new Error('Invalid run name');
    const directory = resolve(runsRoot, runId);
    const relation = relative(directory, resolve(output));
    if (!(isAbsolute(relation) || relation === '..' || relation.startsWith(`..${sep}`)))
      throw new Error('Derived output cannot be inside historical run');
    verifyRunFiles(directory, hashes);
    const plan = z
      .object({
        compression: z.array(conditionSchema),
        sourceHashes: z.object({
          corpus: z.string(),
          evaluation: z.string(),
          manifest: z.string(),
        }),
      })
      .parse(read(resolve(directory, 'plan.json')));
    if (
      plan.sourceHashes.corpus !== manifest.corpusHash ||
      plan.sourceHashes.evaluation !== manifest.evaluationHash ||
      plan.sourceHashes.manifest !== hashJson(manifest)
    )
      throw new Error('Historical corpus differs from frozen scoring reference');
    const observations = journal(resolve(directory, 'observations.jsonl')).map((row) =>
      observationSchema.parse(row),
    );
    const calls = journal(resolve(directory, 'calls.jsonl')).flatMap((row) => {
      const event = z.object({ event: z.string() }).parse(row);
      return event.event === 'response' ? [responseSchema.parse(row)] : [];
    });
    const result = rescoreCompression(evaluation, policy, plan.compression, observations, calls);
    const original = z
      .object({
        groups: z.object({ compression: z.object({ correct: z.number(), total: z.number() }) }),
      })
      .parse(read(resolve(directory, 'report.json')));
    if (result.total !== original.groups.compression.total)
      throw new Error('Historical denominator changed');
    verifyRunFiles(directory, hashes);
    return {
      schemaVersion: 1,
      protocol: policy.protocol,
      runId,
      createdAt: new Date().toISOString(),
      scoringHash: hashJson(policy),
      originalHashesVerified: true,
      originalSha256: hashes,
      originalStrict: original.groups.compression,
      derived: result,
      caveats: [
        'Post-hoc user adjudication after seeing development outputs; not preregistered.',
        'Compression group only; host-fact group is separate.',
        'Format-invalid replies retain overall failure even where human content credit exists.',
        'No API calls; historical files are read-only.',
      ],
    };
  });
  mkdirSync(output);
  for (const report of runs)
    writeFileSync(resolve(output, `${report.runId}.json`), `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
    });
  const summary = [
    '# 人工复核派生报告',
    '',
    '评分协议：unified-scoring@2。A—D接受；E单列内容正确，格式和综合成功仍失败。',
    '',
    '| 运行 | 原始严格分数 | 人工复核后综合分数 | 待复核 |',
    '|---|---|---|---|',
    ...runs.map(
      (run) =>
        `| ${run.runId} | ${run.originalStrict.correct}/${run.originalStrict.total} | ${run.derived.correct}/${run.derived.total} | ${run.derived.questionMetrics.pendingReview} |`,
    ),
    '',
    '这是查看开发集输出后的人工裁决派生结果，不是预注册成绩。原始文件SHA-256已核对，原始分数与调用记录未修改。内容正确率、格式遵守率和综合成功率见各运行JSON；预算跳过和截断保留在计划题目分母。宿主事实组不混合统计。',
    '',
    '模型：Doubao-Seed-2.0-mini，用户确认手动固定选择；实际请求名称ark-code-latest，具体服务端版本未知。两轮输出额度不同，不能据此给策略排名。',
    '',
    '本次离线分析模型API调用：0。',
    '',
  ].join('\n');
  writeFileSync(resolve(output, 'RESULTS.md'), summary, { flag: 'wx' });
  return runs;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [runsRoot, output, ...extra] = process.argv.slice(2);
    if (!runsRoot || !output || extra.length)
      throw new Error('Usage: unified-rescore.ts <runs-root> <new-output-directory>');
    const reports = deriveHistoricalReports(resolve(runsRoot), resolve(output));
    process.stdout.write(
      `${JSON.stringify({ output: resolve(output), apiCalls: 0, scores: reports.map((run) => ({ runId: run.runId, correct: run.derived.correct, total: run.derived.total })) })}\n`,
    );
  } catch {
    process.stderr.write(
      'Offline rescore failed; check source hashes, coverage, and exclusive output directory.\n',
    );
    process.exitCode = 1;
  }
}
