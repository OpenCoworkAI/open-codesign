import { buildSrcdoc } from '@open-codesign/runtime';
import { EmptyState } from '../preview/EmptyState';
import { ErrorState } from '../preview/ErrorState';
import { LoadingState } from '../preview/LoadingState';
import { useCodesignStore } from '../store';

export interface PreviewPaneProps {
  onPickStarter: (prompt: string) => void;
}

export function PreviewPane({ onPickStarter }: PreviewPaneProps) {
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const errorMessage = useCodesignStore((s) => s.errorMessage);
  const retry = useCodesignStore((s) => s.retryLastPrompt);
  const clearError = useCodesignStore((s) => s.clearError);

  let body: React.ReactNode;
  if (errorMessage) {
    body = (
      <ErrorState
        message={errorMessage}
        onRetry={() => {
          void retry();
        }}
        onDismiss={clearError}
      />
    );
  } else if (isGenerating) {
    body = <LoadingState />;
  } else if (previewHtml) {
    body = (
      <div className="h-full p-6">
        <iframe
          key={previewHtml.length}
          title="design-preview"
          sandbox="allow-scripts"
          srcDoc={buildSrcdoc(previewHtml)}
          className="w-full h-full bg-white rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] border border-[var(--color-border)]"
        />
      </div>
    );
  } else {
    body = <EmptyState onPickStarter={onPickStarter} />;
  }

  return <div className="flex-1 overflow-auto">{body}</div>;
}
