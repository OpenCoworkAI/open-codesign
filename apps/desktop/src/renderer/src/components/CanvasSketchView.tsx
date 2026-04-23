import '@excalidraw/excalidraw/index.css';
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { LocalInputFile } from '@open-codesign/shared';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useCodesignStore } from '../store';

type AppState = Parameters<typeof serializeAsJSON>[1];
type BinaryFiles = Parameters<typeof serializeAsJSON>[2];
type ExcalidrawImperativeAPI = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>
>[0];

function extractLocalInputFile(file: File): LocalInputFile | null {
  const path = (file as File & { path?: string }).path;
  if (typeof path !== 'string' || path.length === 0) return null;
  return {
    path,
    name: file.name,
    size: file.size,
  };
}

export function CanvasSketchView() {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const canvasSceneLoaded = useCodesignStore((s) => s.canvasSceneLoaded);
  const canvasSeed = useCodesignStore((s) => s.canvasSeed);
  const ensureCurrentDesign = useCodesignStore((s) => s.ensureCurrentDesign);
  const loadCanvasStateForCurrentDesign = useCodesignStore((s) => s.loadCanvasStateForCurrentDesign);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!window.codesign?.snapshots) return;
    if (!currentDesignId) {
      void ensureCurrentDesign();
      return;
    }
    if (!canvasSceneLoaded) {
      void loadCanvasStateForCurrentDesign();
    }
  }, [currentDesignId, canvasSceneLoaded, ensureCurrentDesign, loadCanvasStateForCurrentDesign]);

  useEffect(() => {
    const flushCanvasState = () => {
      const api = apiRef.current;
      if (!api) return;
      const sceneJson = serializeAsJSON(
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
        'local',
      );
      void useCodesignStore.getState().persistCanvasState(sceneJson);
    };

    const handleBeforeUnload = () => {
      flushCanvasState();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushCanvasState();
    };
  }, []);

  const initialData = useMemo(() => {
    const canvasScene = useCodesignStore.getState().canvasScene;
    if (!canvasScene) return null;
    return {
      elements: canvasScene.elements,
      appState: canvasScene.appState,
      files: canvasScene.files,
    };
  }, [canvasSeed, currentDesignId]);

  if (!currentDesignId || !canvasSceneLoaded) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--color-background)] text-[var(--text-sm)] text-[var(--color-text-muted)]">
        Loading canvas...
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-[var(--color-background)]">
      <Excalidraw
        key={`${currentDesignId}:${canvasSeed}`}
        initialData={initialData}
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        generateIdForFile={async (file) => {
          const localFile = extractLocalInputFile(file);
          if (localFile) {
            useCodesignStore.getState().addCanvasImportedFile(localFile);
          }
          return [
            file.name,
            file.size,
            file.lastModified,
            Math.random().toString(36).slice(2, 8),
          ].join('-');
        }}
        onChange={(
          elements: readonly ExcalidrawElement[],
          appState: AppState,
          files: BinaryFiles,
        ) => {
          useCodesignStore.getState().updateCanvasScene({
            elements,
            appState,
            files,
          });
          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            const api = apiRef.current;
            const latestElements = api?.getSceneElementsIncludingDeleted() ?? elements;
            const latestAppState = api?.getAppState() ?? appState;
            const latestFiles = api?.getFiles() ?? files;
            const sceneJson = serializeAsJSON(latestElements, latestAppState, latestFiles, 'local');
            void useCodesignStore.getState().persistCanvasState(sceneJson);
          }, 350);
        }}
      />
    </div>
  );
}
