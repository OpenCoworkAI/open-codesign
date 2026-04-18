import { useT } from '@open-codesign/i18n';
import { IconButton, Tooltip } from '@open-codesign/ui';
import { Moon, Sun } from 'lucide-react';
import { useCodesignStore } from '../store';

export function ThemeToggle() {
  const t = useT();
  const theme = useCodesignStore((s) => s.theme);
  const toggle = useCodesignStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <Tooltip label={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}>
      <IconButton label={t('theme.toggleAria')} size="sm" onClick={toggle}>
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </IconButton>
    </Tooltip>
  );
}
