import { useEffect, useState } from 'react';
import { useCodesignStore } from '../store';
import { DesignSystemsTab } from './hub/DesignSystemsTab';
import { ExamplesTab } from './hub/ExamplesTab';
import { RecentTab } from './hub/RecentTab';
import { YourDesignsTab } from './hub/YourDesignsTab';

export interface HubViewProps {
  onUseExamplePrompt?: (prompt: string) => void;
}

// Once a tab is visited we keep it mounted (toggled via `hidden`) so the
// DesignCardPreview iframes inside don't unmount and re-parse their srcDoc on
// every tab switch. memCache rehydrates the HTML synchronously, but the iframe
// itself can't be resumed across remounts — keeping the DOM alive is what
// actually kills the white flash.
export function HubView({ onUseExamplePrompt }: HubViewProps = {}) {
  const hubTab = useCodesignStore((s) => s.hubTab);
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set([hubTab]));
  useEffect(() => {
    setMounted((prev) => (prev.has(hubTab) ? prev : new Set([...prev, hubTab])));
  }, [hubTab]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
      <main className="codesign-scroll-area flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-[clamp(var(--space-4),3vw,var(--space-8))] py-[clamp(var(--space-4),3vw,var(--space-8))]">
          {mounted.has('recent') ? (
            <div hidden={hubTab !== 'recent'}>
              <RecentTab />
            </div>
          ) : null}
          {mounted.has('your') ? (
            <div hidden={hubTab !== 'your'}>
              <YourDesignsTab />
            </div>
          ) : null}
          {mounted.has('examples') ? (
            <div hidden={hubTab !== 'examples'}>
              <ExamplesTab onUsePrompt={(example) => onUseExamplePrompt?.(example.prompt)} />
            </div>
          ) : null}
          {mounted.has('designSystems') ? (
            <div hidden={hubTab !== 'designSystems'}>
              <DesignSystemsTab />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
