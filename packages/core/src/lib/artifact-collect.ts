import type { Artifact } from '@open-codesign/shared';

export interface Collected {
  text: string;
  artifacts: Artifact[];
}

export function createHtmlArtifact(content: string, index: number): Artifact {
  return {
    id: `design-${index + 1}`,
    type: 'html',
    title: 'Design',
    content,
    designParams: [],
    createdAt: new Date().toISOString(),
  };
}

export function stripEmptyFences(text: string): string {
  // Streaming parsers emit ```html and the closing ``` as text deltas around
  // structured artifact events, so the artifact body is consumed but the empty
  // fence shell remains in the chat message. Drop those leftover wrappers.
  return text.replace(/```[a-zA-Z0-9]*\s*```/g, '').trim();
}
