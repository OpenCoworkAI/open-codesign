import { initI18n } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import '../../index.css';
import { createRoot } from 'react-dom/client';
import type { CodesignApi } from '../../../../preload';
import { useCodesignStore } from '../../store';
import { FilesTabView } from '../FilesTabView';

async function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  const response = await fetch(`/bridge/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
Object.defineProperty(window, 'codesign', {
  value: {
    files: {
      read: (...args) => rpc('read', args),
      listDir: (...args) => rpc('listDir', args),
    } satisfies Pick<CodesignApi['files'], 'read' | 'listDir'>,
    snapshots: { list: async () => [] } satisfies Pick<CodesignApi['snapshots'], 'list'>,
    sourceEdits: {
      inspect: (...args) => rpc('inspect', args),
      apply: (...args) => rpc('apply', args),
    } satisfies CodesignApi['sourceEdits'],
  },
});
await initI18n('en');
const design = await rpc<Design>('design');
useCodesignStore.setState({
  currentDesignId: design.id,
  designs: [design],
  generationByDesign: {},
});
function Fixture() {
  const toasts = useCodesignStore((state) => state.toasts);
  return (
    <>
      <div style={{ height: 850 }}>
        <FilesTabView />
      </div>
      <output>{toasts.map((toast) => toast.description).join('\n')}</output>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing source-edit fixture root');
createRoot(root).render(<Fixture />);
