import {
  type BuildDesignContextPackInput,
  buildDesignContextPack,
  type DesignContextPackV1,
} from '../../packages/core/src/design-context.js';

/**
 * Research adapter for the production context pack. It intentionally delegates
 * to `buildDesignContextPack` without re-implementing budgeting so the
 * baseline cannot drift from shipped behavior.
 */
export function buildProductionBaseline(input: BuildDesignContextPackInput): DesignContextPackV1 {
  return buildDesignContextPack(input);
}
