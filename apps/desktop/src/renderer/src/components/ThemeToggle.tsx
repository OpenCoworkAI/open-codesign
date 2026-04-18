import { IconButton, Tooltip } from '@open-codesign/ui';
import { Moon, Sun } from 'lucide-react';
import { useCodesignStore } from '../store';

export function ThemeToggle() {
  const theme = useCodesignStore((s) => s.theme);
  const toggle = useCodesignStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <Tooltip label={isDark ? 'Switch to light' : 'Switch to dark'}>
      <IconButton label="Toggle theme" onClick={toggle}>
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </IconButton>
    </Tooltip>
  );
}
