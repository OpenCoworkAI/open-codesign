import { useT } from '@open-codesign/i18n';
import { useCodesignStore } from '../../store';
import { DesignGrid } from './DesignGrid';
import { collapseWorkspaceDesigns } from './RecentTab';

export function YourDesignsTab() {
  const t = useT();
  const designs = useCodesignStore((s) => s.designs);
  const sorted = [...designs]
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return <DesignGrid designs={collapseWorkspaceDesigns(sorted)} emptyLabel={t('hub.your.empty')} />;
}
