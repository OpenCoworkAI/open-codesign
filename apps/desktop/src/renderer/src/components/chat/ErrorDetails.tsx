import './ErrorDetails.css';

export function summarizeError(message: string): string {
  const argumentsStart = message.startsWith('Validation failed for tool')
    ? message.indexOf('\nReceived arguments:')
    : -1;
  const summary = (argumentsStart < 0 ? message : message.slice(0, argumentsStart))
    .replace(/\s+/g, ' ')
    .trim();
  return summary.length > 200 ? `${summary.slice(0, 197)}...` : summary;
}

export function ErrorDetails({ message }: { message: string }) {
  const summary = summarizeError(message);
  if (summary === message.trim()) {
    return <div className="codesign-error-summary">{summary}</div>;
  }
  return (
    <details className="codesign-error-details">
      <summary>{summary}</summary>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded diagnostic region must support keyboard scrolling. */}
      <pre role="region" aria-label={summary} tabIndex={0}>
        {message}
      </pre>
    </details>
  );
}
