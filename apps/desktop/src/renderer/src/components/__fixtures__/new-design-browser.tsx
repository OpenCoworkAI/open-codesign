import { initI18n } from '@open-codesign/i18n';
import type { SourceEntryResultV1 } from '@open-codesign/shared';
import '../../index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CodesignApi } from '../../../../preload';
import { useCodesignStore } from '../../store';
import { NewDesignDialog } from '../NewDesignDialog';

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
    snapshots: {
      createDesign: (...args) => rpc('create', args),
      listDesigns: () => rpc('list'),
      pickWorkspaceFolder: () => rpc('pick'),
    } satisfies Pick<
      CodesignApi['snapshots'],
      'createDesign' | 'listDesigns' | 'pickWorkspaceFolder'
    >,
  },
});
await initI18n(new URL(window.location.href).searchParams.get('locale') === 'zh' ? 'zh-CN' : 'en');
useCodesignStore.setState({
  newDesignDialogOpen: true,
  designs: [],
  currentDesignId: null,
  syncActiveMessages: async () => {},
  loadChatForCurrentDesign: async () => {},
  loadCommentsForCurrentDesign: async () => {},
});
function Fixture() {
  const designId = useCodesignStore((state) => state.currentDesignId);
  const [entry, setEntry] = useState<SourceEntryResultV1 | null>(null);
  useEffect(() => {
    if (designId) void rpc<SourceEntryResultV1>('entry', [designId]).then(setEntry);
  }, [designId]);
  return (
    <>
      <NewDesignDialog />
      <output data-entry>{entry ? JSON.stringify(entry) : ''}</output>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing creation fixture root');
createRoot(root).render(<Fixture />);
