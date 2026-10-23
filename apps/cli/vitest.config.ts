import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Doctor/inspect contracts spawn guarded Node subprocesses; under CI
    // load the default 5s per-test ceiling flakes.
    testTimeout: 30_000,
  },
});

