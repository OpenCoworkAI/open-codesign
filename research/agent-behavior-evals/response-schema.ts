import { responseContract } from './fixtures.mjs';

// Shape only: never encode a case's targets, expected action or other labels.
export const decisionSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(responseContract),
  properties: {
    action: { type: 'string', enum: responseContract.action },
    status: { type: 'string', enum: responseContract.status },
    targetIds: { type: 'array', items: { type: 'string' } },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value'],
        properties: { field: { type: 'string' }, value: { type: 'string' } },
      },
    },
    expectedSourceHash: {
      anyOf: [{ type: 'string', pattern: '^[a-f0-9]{64}$' }, { type: 'null' }],
    },
  },
};

export const typedProtocolInstructions = [
  'Return one JSON object, not the schema itself. The first character must be { and the last character must be }. No Markdown fences, explanation or extra fields.',
  `Your JSON object must match this JSON Schema: ${JSON.stringify(decisionSchema)}`,
  'action and status are single strings chosen from their enum lists, never arrays. targetIds is an array of object IDs, not observation names.',
  'changes is one array of field/value pairs applied to EVERY targetId. List each requested field update once, not once per target. All field values are strings.',
  'For a non-edit action, targetIds and changes must both be [] and expectedSourceHash must be null. For an edit, expectedSourceHash is the current sourceHash being edited.',
];
