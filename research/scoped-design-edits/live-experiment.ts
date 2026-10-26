import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { digest, executeFile, proposalSchema } from './file-executor';
import { liveCases } from './live-cases';

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export type Call = (
  id: string,
  messages: Message[],
  schema: Record<string, unknown>,
) => Promise<{ status: string; value: unknown }>;
export function scopePlan() {
  return liveCases().map((fixture) => ({
    ...fixture,
    messages: [
      {
        role: 'system',
        content: `Propose exactly one literal source-definition edit. Follow the latest user request and preserve everything else. Return only JSON matching ${JSON.stringify(proposalSchema)}. All fields are strings. kind is set-text, set-style or set-attribute. For set-text field must be text; otherwise field is the actual property or attribute name. Copy the current sourceHash and AST targetId exactly. No Markdown.`,
      },
      { role: 'user', content: JSON.stringify(fixture.input) },
    ] as Message[],
  }));
}

export async function scopeExperiment(output: string, call: Call) {
  mkdirSync(output, { recursive: false });
  const plan = scopePlan();
  writeFileSync(
    path.join(output, 'plan.json'),
    JSON.stringify(
      { schemaVersion: 1, trials: 1, initialCalls: 6, maxRepairCalls: 6, cases: plan },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  const rows = [];
  for (const fixture of plan) {
    const roots = Object.fromEntries(
      ['baseline', 'guarded'].map((arm) => {
        const dir = path.join(output, `${fixture.id}-${arm}`);
        mkdirSync(dir);
        for (const [file, source] of Object.entries(fixture.files))
          writeFileSync(path.join(dir, file), source);
        return [arm, dir];
      }),
    );
    const snapshot = (root: string) =>
      Object.fromEntries(
        Object.keys(fixture.files).map((file) => [
          file,
          digest(readFileSync(path.join(root, file), 'utf8')),
        ]),
      );
    const successful = (root: string) =>
      readFileSync(path.join(root, 'App.jsx'), 'utf8') === fixture.expectedContent &&
      readFileSync(path.join(root, 'Archive.jsx'), 'utf8') === fixture.files['Archive.jsx'];
    const first = await call(`${fixture.id}/first`, fixture.messages, proposalSchema);
    const baseline = executeFile(roots.baseline, fixture.grant, first.value, false);
    const before = snapshot(roots.guarded);
    const guarded = executeFile(roots.guarded, fixture.grant, first.value, true);
    const after = snapshot(roots.guarded);
    const baselineSuccess = successful(roots.baseline);
    const guardedFirstSuccess = successful(roots.guarded);
    let repair = null;
    if (
      guarded.status === 'rejected' &&
      !['timeout', 'provider_error', 'credential-in-response'].includes(first.status)
    ) {
      // Feedback contains operational observations and the original selection, never the expected content.
      const messages: Message[] = [
        ...fixture.messages,
        { role: 'assistant', content: JSON.stringify(first.value) },
        {
          role: 'user',
          content: JSON.stringify({
            toolResult: guarded,
            currentSelection: fixture.input.selection,
            sourceHash: fixture.grant.sourceHash,
            request:
              'The file was not modified. Correct the proposal once, preserving the original request and selection.',
          }),
        },
      ];
      const response = await call(`${fixture.id}/repair`, messages, proposalSchema);
      repair = {
        status: response.status,
        execution: executeFile(roots.guarded, fixture.grant, response.value, true),
      };
    }
    rows.push({
      id: fixture.id,
      modelStatus: first.status,
      baseline,
      guarded,
      baselineSuccess,
      guardedFirstSuccess,
      blockedWithoutWrites:
        guarded.status === 'rejected' ? JSON.stringify(before) === JSON.stringify(after) : null,
      repair,
      finalSuccess: successful(roots.guarded),
      baselineSnapshot: snapshot(roots.baseline),
      guardedSnapshot: snapshot(roots.guarded),
    });
    writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify({ planned: plan.length, rows }, null, 2),
    );
  }
  return rows;
}
