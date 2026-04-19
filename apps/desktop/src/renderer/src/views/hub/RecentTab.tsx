import { useT } from '@open-codesign/i18n';
import { useCodesignStore } from '../../store';
import { ProjectGrid } from './ProjectGrid';

const RECENT_LIMIT = 6;

export function RecentTab() {
  const t = useT();
  const projects = useCodesignStore((s) => s.projects);
  const recent = [...projects]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, RECENT_LIMIT);
  return <ProjectGrid projects={recent} emptyLabel={t('hub.recent.empty')} />;
}
