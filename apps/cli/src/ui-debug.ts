import { fileURLToPath, pathToFileURL } from 'node:url';
import type { UiDebugHost, UiDebugReport } from '../../desktop/src/debug/contract';
import type { Arguments } from './arguments';
import { CliError, type Result } from './protocol';

/** Developer-only adapter. UI automation dependencies stay in the desktop workspace. */
export async function loadUiDebugHost(): Promise<UiDebugHost> {
  try {
    const entry = fileURLToPath(new URL('../../desktop/out/main/ui-debug.js', import.meta.url));
    return (await import(pathToFileURL(entry).href)) as UiDebugHost;
  } catch {
    throw new CliError(
      'runtime',
      'UI_DEBUG_BUILD_REQUIRED',
      'Build first: pnpm --filter @open-codesign/desktop build --mode background-debug',
    );
  }
}

export async function debugUi(args: Arguments, signal: AbortSignal): Promise<Result> {
  const host = await loadUiDebugHost();
  let steps: Awaited<ReturnType<UiDebugHost['loadUiSteps']>>;
  try {
    steps = await host.loadUiSteps(args.steps);
  } catch {
    throw new CliError(
      'usage',
      'INVALID_UI_STEPS',
      'Steps file must contain schemaVersion 1 and 1–16 valid preview steps.',
    );
  }
  let report: UiDebugReport;
  try {
    report = await host.runUiDebug({
      output: args.output ?? '',
      steps,
      signal,
      defaultJourney: args.steps === undefined,
    });
  } catch {
    throw new CliError(
      'runtime',
      'UI_DEBUG_SETUP_FAILED',
      'Ensure the output directory is new with an accessible parent, and rebuild current sources: pnpm --filter @open-codesign/desktop build --mode background-debug',
    );
  }
  const unsupported = report.errors.some((error) => error.source === 'host:unsupported');
  return {
    data: report,
    ...(report.ok
      ? {}
      : {
          error: new CliError(
            unsupported ? 'unsupported' : 'task',
            unsupported ? 'UI_DEBUG_UNSUPPORTED' : 'UI_DEBUG_FAILED',
            'Background UI verification failed. Inspect report.json and screenshots in the output directory.',
          ),
        }),
  };
}
