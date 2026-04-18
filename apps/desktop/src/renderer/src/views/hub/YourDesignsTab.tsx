import { useT } from '@open-codesign/i18n';
import { useCodesignStore } from '../../store';
import { ProjectGrid } from './ProjectGrid';

export function YourDesignsTab() {
  const t = useT();
  const projects = useCodesignStore((s) => s.projects);
  const sorted = [...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return <ProjectGrid projects={sorted} emptyLabel={t('hub.your.empty')} />;
}
