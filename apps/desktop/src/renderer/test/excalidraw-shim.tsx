import type { ReactNode } from 'react';

type BinaryFiles = Record<string, unknown>;
type ExcalidrawElementLike = {
  id?: string;
  type?: string;
  isDeleted?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
};

export function Excalidraw(_props: Record<string, unknown>): ReactNode {
  return null;
}

export function serializeAsJSON(
  elements: readonly ExcalidrawElementLike[],
  appState: Record<string, unknown> | null,
  files: BinaryFiles | null,
  source?: string,
): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: source ?? 'test',
    elements,
    appState: appState ?? {},
    files: files ?? {},
  });
}

export function restore(
  data: {
    elements?: readonly ExcalidrawElementLike[];
    appState?: Record<string, unknown>;
    files?: BinaryFiles;
  } | null,
) {
  return {
    elements: data?.elements ?? [],
    appState: data?.appState ?? {},
    files: data?.files ?? {},
  };
}

export function getNonDeletedElements(elements: readonly ExcalidrawElementLike[]) {
  return elements.filter((element) => !element?.isDeleted);
}

export async function exportToSvg(input: {
  elements: readonly ExcalidrawElementLike[];
  appState?: Record<string, unknown> | null;
  exportingFrame?: ExcalidrawElementLike | null;
}) {
  const frameLabel = input.exportingFrame?.type ? ` frame="${input.exportingFrame.type}"` : '';
  const background = String(input.appState?.['viewBackgroundColor'] ?? '#ffffff');
  return {
    outerHTML: `<svg data-excalidraw-shim="true" data-elements="${input.elements.length}" data-background="${background}"${frameLabel}></svg>`,
  };
}
