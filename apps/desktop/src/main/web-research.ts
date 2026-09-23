import path from 'node:path';
import type { AskInput, AskResult } from '@open-codesign/core';
import { readResearchSlides } from '@open-codesign/exporters';
import type {
  ResearchHost,
  ResearchSlide,
  ResearchStore,
  WebResearchNetwork,
} from '@open-codesign/shared';
import { withWorkspaceFileWriter } from '@open-codesign/shared/workspace-file-lock';
import {
  buildSourcesMarkdown,
  linkSlide,
  loadResearchStore,
  recordEvidence,
  researchSourcePath,
  saveResearchStore,
  saveSources,
  writeUniqueSources,
} from './web-research-store';
import { readWorkspaceFileAt } from './workspace-reader';

type InWorkspace = <T>(fn: (root: string) => Promise<T>) => Promise<T>;
export interface ResearchHostOptions {
  network: WebResearchNetwork;
  inWorkspace: InWorkspace;
  authorize: (signal?: AbortSignal) => Promise<void>;
  slides?: (source: string, root: string, sourcePath: string) => Promise<ResearchSlide[]>;
}

export function createResearchHost(options: ResearchHostOptions): ResearchHost {
  const slides =
    options.slides ??
    ((source, root, sourcePath) =>
      readResearchSlides(source, {
        assetBasePath: path.join(root, path.dirname(sourcePath)),
        assetRootPath: root,
        sourcePath,
      }));
  const transaction = <T>(
    fn: (store: ResearchStore, root: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> =>
    options.inWorkspace((root) =>
      withWorkspaceFileWriter(path.join(root, '.codesign', 'research.json'), async () => {
        signal?.throwIfAborted();
        const store = await loadResearchStore(root);
        const result = await fn(store, root);
        signal?.throwIfAborted();
        await saveResearchStore(root, store);
        return result;
      }),
    );
  return {
    async search(query, count, signal) {
      await options.authorize(signal);
      const sources = await options.network.search(query, count, signal);
      await transaction(async (store) => {
        saveSources(store, sources);
      }, signal);
      return sources;
    },
    async fetch(url, signal) {
      await options.authorize(signal);
      const result = await options.network.fetch(url, signal);
      await transaction(async (store) => {
        saveSources(store, [result.source]);
      }, signal);
      return result;
    },
    recordEvidence(input, signal) {
      return transaction(async (store) => recordEvidence(store, input), signal);
    },
    linkSlide(rawPath, slideId, evidenceIds, signal) {
      const sourcePath = researchSourcePath(rawPath);
      return transaction(async (store, root) => {
        const source = await readWorkspaceFileAt(root, sourcePath);
        const current = await slides(source.content, root, sourcePath);
        const slide = current.find((s) => s.id === slideId);
        if (!slide) throw new Error('Slide ID not found in the current rendered deck.');
        linkSlide(store, sourcePath, slide, evidenceIds);
        return slide;
      }, signal);
    },
    exportSources(rawPath, signal) {
      const sourcePath = researchSourcePath(rawPath);
      return transaction(async (store, root) => {
        const source = await readWorkspaceFileAt(root, sourcePath);
        const current = await slides(source.content, root, sourcePath);
        if (!current.length)
          throw new Error(
            'No research slides found; use section elements with stable data-slide-id.',
          );
        const { markdown, warnings } = buildSourcesMarkdown(store, sourcePath, current);
        signal?.throwIfAborted();
        const file = await writeUniqueSources(root, 'sources', markdown);
        return { path: path.relative(root, file).replace(/\\/g, '/'), warnings };
      }, signal);
    },
    readRecords(signal) {
      return options.inWorkspace((root) =>
        withWorkspaceFileWriter(path.join(root, '.codesign', 'research.json'), async () => {
          signal?.throwIfAborted();
          const store = await loadResearchStore(root);
          signal?.throwIfAborted();
          return store;
        }),
      );
    },
  };
}

export function createWebResearchAuthorization(
  settings: { enabled: boolean; maxCalls: number },
  request: (input: AskInput, signal?: AbortSignal) => Promise<AskResult>,
): (signal?: AbortSignal) => Promise<void> {
  let decision: Promise<boolean> | undefined;
  return async (signal) => {
    signal?.throwIfAborted();
    if (!settings.enabled) return;
    decision ??= request(
      {
        rationale:
          'Tier 1 network permission. Queries go to Tavily; webpage requests go to public hosts. This decision applies only to the current run.',
        questions: [
          {
            id: 'web-research-permission',
            type: 'text-options',
            prompt: `Allow up to ${settings.maxCalls} public web search/page requests for this run?`,
            options: ['Allow this run', 'Deny'],
            multi: false,
          },
        ],
      },
      signal,
    ).then(
      (result) =>
        result.status === 'answered' &&
        result.answers.some(
          (answer) =>
            answer.questionId === 'web-research-permission' && answer.value === 'Allow this run',
        ),
    );
    const allowed = await decision;
    signal?.throwIfAborted();
    if (!allowed)
      throw new Error('Web research permission denied. Use local/saved materials only.');
  };
}
