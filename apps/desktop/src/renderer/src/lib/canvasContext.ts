import { exportToSvg, getNonDeletedElements } from '@excalidraw/excalidraw';
import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
} from '@excalidraw/excalidraw/element/types';

type ExportToSvgOptions = Parameters<typeof exportToSvg>[0];
type AppState = NonNullable<ExportToSvgOptions['appState']>;
type BinaryFiles = Exclude<ExportToSvgOptions['files'], null>;

export interface CanvasSceneSnapshot {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

export interface CanvasContextArtifact {
  name: string;
  content: string;
}

const MAX_FRAME_EXPORTS = 4;

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/data:image\/[^"]+/g, 'data:image/omitted')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeElement(element: ExcalidrawElement): string {
  const parts = [`- ${element.type}`];
  if ('x' in element && 'y' in element) {
    parts.push(`at (${Math.round(element.x)}, ${Math.round(element.y)})`);
  }
  if ('width' in element && 'height' in element) {
    parts.push(`size ${Math.round(element.width)}x${Math.round(element.height)}`);
  }
  if ('text' in element && typeof element.text === 'string' && element.text.trim().length > 0) {
    parts.push(`text "${element.text.trim().slice(0, 120)}"`);
  }
  if (element.type === 'image') {
    parts.push('image');
  }
  return parts.join(' | ');
}

function buildSummary(scene: CanvasSceneSnapshot): string {
  const elements = getNonDeletedElements(scene.elements);
  const frames = elements.filter(
    (element): element is ExcalidrawFrameLikeElement =>
      element.type === 'frame' || element.type === 'magicframe',
  );
  const topText = elements
    .filter((element): element is ExcalidrawElement & { text: string } => 'text' in element)
    .map((element) => element.text.trim())
    .filter((text) => text.length > 0)
    .slice(0, 12);

  const lines = [
    '# Canvas context',
    '',
    `- Total visible elements: ${elements.length}`,
    `- Frames: ${frames.length}`,
    `- Imported image elements: ${elements.filter((element) => element.type === 'image').length}`,
  ];

  if (topText.length > 0) {
    lines.push('- Notable text labels:');
    lines.push(...topText.map((text) => `  - ${text}`));
  }

  if (frames.length > 0) {
    lines.push('', '## Frames');
    frames.slice(0, MAX_FRAME_EXPORTS).forEach((frame, index) => {
      lines.push(`### Frame ${index + 1}`);
      lines.push(describeElement(frame));
    });
  }

  lines.push('', '## Elements');
  elements.slice(0, 60).forEach((element) => {
    lines.push(describeElement(element));
  });

  if (elements.length > 60) {
    lines.push(`- ... ${elements.length - 60} more elements omitted`);
  }

  return lines.join('\n');
}

async function exportSvg(
  name: string,
  scene: CanvasSceneSnapshot,
  exportingFrame?: ExcalidrawFrameLikeElement,
): Promise<CanvasContextArtifact> {
  const svg = await exportToSvg({
    elements: getNonDeletedElements(scene.elements),
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: '#ffffff',
      ...scene.appState,
    },
    files: scene.files,
    exportingFrame: exportingFrame ?? null,
  });
  return {
    name,
    content: sanitizeSvg(svg.outerHTML),
  };
}

export function hasCanvasContent(scene: CanvasSceneSnapshot | null): boolean {
  return Boolean(scene && getNonDeletedElements(scene.elements).length > 0);
}

export async function buildCanvasContextArtifacts(
  scene: CanvasSceneSnapshot | null,
): Promise<CanvasContextArtifact[]> {
  if (!hasCanvasContent(scene)) return [];

  const safeScene = scene as CanvasSceneSnapshot;
  const artifacts: CanvasContextArtifact[] = [
    {
      name: 'canvas-summary.md',
      content: buildSummary(safeScene),
    },
  ];

  const frames = getNonDeletedElements(safeScene.elements).filter(
    (element): element is ExcalidrawFrameLikeElement =>
      element.type === 'frame' || element.type === 'magicframe',
  );

  if (frames.length > 0) {
    const frameExports = await Promise.all(
      frames
        .slice(0, MAX_FRAME_EXPORTS)
        .map((frame, index) => exportSvg(`canvas-frame-${index + 1}.svg`, safeScene, frame)),
    );
    artifacts.push(...frameExports);
  } else {
    artifacts.push(await exportSvg('canvas.svg', safeScene));
  }

  return artifacts;
}
