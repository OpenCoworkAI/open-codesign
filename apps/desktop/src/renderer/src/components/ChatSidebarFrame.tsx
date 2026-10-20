import { useT } from '@open-codesign/i18n';
import { IconButton } from '@open-codesign/ui';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { type MouseEventHandler, type ReactNode, useId } from 'react';

export function ChatSidebarFrame({
  collapsed,
  fullscreen,
  width,
  onCollapsedChange,
  onResizeStart,
  children,
}: {
  collapsed: boolean;
  fullscreen: boolean;
  width: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const t = useT();
  const contentId = useId();
  const label = t(collapsed ? 'sidebar.expand' : 'sidebar.collapse');
  return (
    <div
      hidden={fullscreen}
      className="codesign-chat-frame relative flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      data-collapsed={collapsed}
      style={{ width: collapsed ? 'var(--space-12)' : width }}
    >
      <div className="flex h-[var(--size-control-md)] shrink-0 items-center justify-end px-[var(--space-1)]">
        <IconButton
          label={label}
          title={label}
          aria-controls={contentId}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[var(--space-5)]" aria-hidden />
          ) : (
            <PanelLeftClose className="size-[var(--space-5)]" aria-hidden />
          )}
        </IconButton>
      </div>
      <div id={contentId} hidden={collapsed} className="min-h-0 flex-1">
        {children}
      </div>
      <div
        hidden={collapsed}
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onResizeStart}
        className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/15 active:bg-[var(--color-accent)]/25 transition-colors duration-100"
        style={{ transform: 'translateX(50%)' }}
      />
    </div>
  );
}
