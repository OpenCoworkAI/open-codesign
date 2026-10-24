import { fileURLToPath, pathToFileURL } from 'node:url';
import type { UiDebugHost, UiDebugReport } from '../../desktop/src/debug/contract';
import type { Arguments } from './arguments';
import { CliError, type Result } from './protocol';

export function uiLeaseError(error: unknown): CliError | undefined {
  if (!(error instanceof Error)) return undefined;
  if (!/^UI_DEBUG_(BUSY|INVALID_LEASE|LEASE_CHANGED)/.test(error.message)) return undefined;
  return new CliError(
    'runtime',
    'UI_DEBUG_BUSY',
    'Another UI run owns the shared lease, or its cleanup is unconfirmed. Close it first; see BACKGROUND_DEBUG.md for stale-lease recovery.',
  );
}

export function modelSetupError(errors: UiDebugReport['errors']): CliError | undefined {
  const code = errors.find((error) => error.source === 'model-setup')?.message;
  if (!code) return undefined;
  return new CliError(
    code.endsWith('_UNSUPPORTED') ? 'unsupported' : 'configuration',
    'UI_MODEL_SETUP_FAILED',
    'Selected model configuration is unavailable or unsupported. Inspect the model-setup reason in report.json. No personal configuration was changed.',
  );
}

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
  } catch (error) {
    const busy = uiLeaseError(error);
    if (busy) throw busy;
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
