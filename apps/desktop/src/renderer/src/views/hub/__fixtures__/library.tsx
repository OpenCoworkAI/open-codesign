import { initI18n } from '@open-codesign/i18n';
import { createRoot } from 'react-dom/client';
import type { CodesignApi } from '../../../../../preload';
import '../../../index.css';
import { DesignSystemWorkspaceActions } from '../../../components/DesignSystemWorkspaceActions';
import { NewDesignDialog } from '../../../components/NewDesignDialog';
import { useCodesignStore } from '../../../store';
import { DesignSystemsTab } from '../DesignSystemsTab';

async function rpc<T>(channel: string, data: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/library-bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, data: { schemaVersion: 1, ...data } }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
const systems: CodesignApi['designSystems'] = {
  list: () => rpc('design-systems:v1:list'),
  get: (id) => rpc('design-systems:v1:get', { id }),
  create: (name, description) => rpc('design-systems:v1:create', { name, description }),
  fork: (id, name) => rpc('design-systems:v1:fork', { id, name }),
  edit: (id) => rpc('design-systems:v1:edit', { id }),
  validate: (id) => rpc('design-systems:v1:validate', { id }),
  update: (id, name, description) => rpc('design-systems:v1:update', { id, name, description }),
  import: (designId) => rpc('design-systems:v1:import', { designId }),
  remove: (id) => rpc('design-systems:v1:delete', { id }),
  export: (id) => rpc('design-systems:v1:export', { id }),
};
Object.defineProperty(window, 'codesign', {
  value: {
    designSystems: systems,
    snapshots: {
      listDesigns: () => rpc('snapshots:v1:list-designs'),
      createDesign: (name, workspacePath, demoInputId, designSystemId) =>
        rpc('snapshots:v1:create-design', { name, workspacePath, demoInputId, designSystemId }),
      list: (designId) => rpc('snapshots:v1:list', { designId }),
      getDesign: (id) => rpc('snapshots:v1:get-design', { id }),
    } satisfies Pick<
      CodesignApi['snapshots'],
      'listDesigns' | 'createDesign' | 'list' | 'getDesign'
    >,
    files: {
      read: (designId, file) => rpc('codesign:files:v1:read', { designId, path: file }),
    } satisfies Pick<CodesignApi['files'], 'read'>,
    chat: { list: async () => [], seedFromSnapshots: async () => ({ inserted: 0 }) } satisfies Pick<
      CodesignApi['chat'],
      'list' | 'seedFromSnapshots'
    >,
    comments: { list: async () => [] } satisfies Pick<CodesignApi['comments'], 'list'>,
  },
});
await initI18n('zh-CN');
useCodesignStore.setState({ view: 'hub', hubTab: 'resources', generationByDesign: {} });
await useCodesignStore.getState().loadDesigns();
function Fixture() {
  const view = useCodesignStore((s) => s.view);
  const current = useCodesignStore((s) => s.designs.find((d) => d.id === s.currentDesignId));
  return (
    <div style={{ height: '100vh', overflow: 'auto', padding: 24 }}>
      <div
        hidden={view !== 'hub'}
        style={{
          height: '100%',
          display: view === 'hub' ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        <button type="button" onClick={() => useCodesignStore.getState().openNewDesignDialog()}>
          新建设计
        </button>
        <div style={{ flex: 1, minHeight: 0 }}>
          <DesignSystemsTab />
        </div>
      </div>
      {view === 'workspace' && (
        <section aria-label="Editor">
          <h1>{current?.name}</h1>
          <DesignSystemWorkspaceActions />
          <button type="button" onClick={() => useCodesignStore.getState().setView('hub')}>
            返回库
          </button>
        </section>
      )}
      <NewDesignDialog />
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
createRoot(root).render(<Fixture />);
