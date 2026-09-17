import { initI18n } from '@open-codesign/i18n';
import '../../index.css';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CodesignApi } from '../../../../preload';
import type { WorkspacePreviewReadResult } from '../../preview/workspace-source';
import { useCodesignStore } from '../../store';
import { TweakPanel } from '../TweakPanel';
import { isColorString } from '../TweakPanel.inputs';

declare global {
  interface Window {
    tweakRead: CodesignApi['files']['read'];
    tweakWrite: CodesignApi['files']['write'];
    tweakFixture: {
      replace: (designId: string, source: WorkspacePreviewReadResult) => void;
      generating: () => void;
      colors: (values: string[]) => boolean[];
    };
  }
}

Object.defineProperty(window, 'codesign', {
  value: {
    files: {
      read: (...args) => window.tweakRead(...args),
      write: (...args) => window.tweakWrite(...args),
    } satisfies Pick<CodesignApi['files'], 'read' | 'write'>,
  },
});
await initI18n('en');
useCodesignStore.setState({ currentDesignId: 'first', generationByDesign: {} });
const initialSource = await window.tweakRead('first', 'App.jsx');

function Fixture() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<WorkspacePreviewReadResult>(initialSource);
  const toasts = useCodesignStore((state) => state.toasts);
  window.tweakFixture = {
    replace(designId, next) {
      useCodesignStore.setState({ currentDesignId: designId });
      setSource(next);
    },
    generating() {
      const id = useCodesignStore.getState().currentDesignId;
      if (!id) throw new Error('Missing design');
      useCodesignStore.setState({
        generationByDesign: {
          [id]: { generationId: 'running', stage: 'thinking', awaitingResponse: false },
        },
      });
    },
    colors: (values) => values.map(isColorString),
  };
  return (
    <>
      <iframe
        ref={iframeRef}
        title="Persistent artifact"
        srcDoc={
          '<input value="artifact state"><script>window.updates=[];window.addEventListener("message",e=>window.updates.push(e.data))</script>'
        }
      />
      <TweakPanel
        iframeRef={iframeRef}
        presentation="inspector"
        source={source}
        onPersist={setSource}
      />
      <output>{toasts.map((toast) => toast.description).join('\n')}</output>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(<Fixture />);
