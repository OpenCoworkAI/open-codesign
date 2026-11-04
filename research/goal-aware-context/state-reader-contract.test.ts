import { describe, expect, it } from 'vitest';
import { stateAnswerSchema } from './state-evaluation.js';
import { prepareStateCalibration } from './state-reader-calibration.js';
import { stateReaderContract } from './state-reader-contract.js';
import { prepareStateStress } from './state-stress.js';

const config = {
  budgets: [2048],
  trials: 1,
  maxCalls: 64,
  maxOutputTokens: 4096,
  summaryMaxBytes: 1800,
};
describe('reader output contract', () => {
  it('states the requested subject without supplying its answer and limits local output to the active design', () => {
    expect(stateReaderContract.prompt).toContain(
      'diskColor asks for the latest on-disk observation',
    );
    expect(stateReaderContract.prompt).toContain('font asks for the user decision');
    expect(stateReaderContract.prompt).toContain('active design only');
    expect(stateReaderContract.prompt).toContain(
      'nextAction asks for the earliest uncompleted required action',
    );
  });
  it('derives workspace nullability from the actual scoring schema', () => {
    const json = stateReaderContract.jsonSchema;
    expect(json).toMatchObject({
      properties: {
        states: {
          items: {
            properties: {
              scope: { properties: { workspaceId: { type: 'string', minLength: 1 } } },
            },
          },
        },
      },
    });
    expect(
      stateAnswerSchema.safeParse({
        states: [
          {
            key: 'x',
            kind: 'intent',
            value: 'keep',
            scope: {
              workspaceId: null,
              designId: null,
              file: null,
              objectId: null,
              field: 'x',
              revision: null,
            },
            sources: [],
            invalidation: { status: 'active', rules: [] },
          },
        ],
      }).success,
    ).toBe(false);
    expect(stateReaderContract.prompt).not.toContain('strings or null for scope identifiers');
  });
  it('gives every strategy and the raw-prefix control the same generic task contract', () => {
    const stress = prepareStateStress(config),
      control = prepareStateCalibration(config);
    expect(stress.plan.readerContractId).toBe('trace-state-reader@3');
    expect(control.plan.readerContractId).toBe(stress.plan.readerContractId);
    expect(control.plan.probePrompt).toBe(stress.plan.probePrompt);
    expect(stress.plan.probePrompt).toBe(stateReaderContract.prompt);
    for (const privateText of [
      '#2463A6',
      '#317245',
      'Georgia',
      'Inter',
      'version-facts',
      'recovery-action',
      'acceptedValues',
      'acceptedSourceSets',
      'referenceRules',
    ])
      expect(stress.plan.probePrompt).not.toContain(privateText);
  });
  it('defines forward invalidation, atomic values and kinds instead of providing an empty template', () => {
    expect(stateReaderContract.prompt).toContain('future events');
    expect(stateReaderContract.prompt).toContain('one atomic value');
    expect(stateReaderContract.prompt).toContain('workspace-global');
    expect(stateReaderContract.prompt).toContain('until-completed');
    expect(stateReaderContract.prompt).toContain('pending required action');
    expect(stateReaderContract.prompt).not.toContain('"rules":[]');
  });
});
