import { fixtures, responseContract } from './fixtures.mjs';
import { sessionFixtures } from './session-fixtures.mjs';

export function getFixtures(dataset = 'synthetic-v1') {
  switch (dataset) {
    case 'synthetic-v1':
      return fixtures;
    case 'design-sessions-v1':
      return sessionFixtures;
    default:
      throw new Error('Unknown dataset');
  }
}

export function exportTasks(dataset = 'synthetic-v1') {
  return {
    schemaVersion: 1,
    responseContract,
    tasks: getFixtures(dataset).map(({ id, prompt, context }) => ({ id, prompt, context })),
  };
}
