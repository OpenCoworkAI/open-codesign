/**
 * System prompt composer for open-codesign.
 *
 * Prompt text lives in `sections/*.md` and is loaded once at module init by
 * `sections/loader.ts`. The composer is intentionally deterministic: create
 * create prompts no longer branch on brief text. Progressive disclosure now
 * happens through resource manifests plus `skill()` / `scaffold()` tool calls.
 */

import { composeFull } from './compose-full.js';

export { PROMPT_SECTION_FILES, PROMPT_SECTIONS } from './sections/loader.js';

export interface PromptComposeOptions {
  /** Generation mode:
   *  - `create`  — fresh design from a prompt
   *  - `tweak`   — update EDITMODE parameters only
   *  - `revise`  — targeted edit of an existing artifact
   */
  mode: 'create' | 'tweak' | 'revise';
  /**
   * Kept for call-site compatibility. The composer does not inspect prompt text;
   * relevant optional guidance is discovered from resource manifests and loaded
   * through tools.
   */
  userPrompt?: string | undefined;
  /** Resource-manifest sections to append. These are short indexes, not bodies. */
  resources?: string[] | undefined;
}

/**
 * Assembles the system prompt from section constants according to the requested
 * generation mode.
 *
 * Brand tokens and other user-filesystem data are intentionally excluded here.
 * They are passed as untrusted user-role content in the message array to prevent
 * prompt injection attacks from adversarial codebase content.
 */
export function composeSystemPrompt(opts: PromptComposeOptions): string {
  const sections = composeFull(opts.mode);

  if (opts.resources?.length) {
    sections.push(opts.resources.join('\n\n---\n\n'));
  }

  return sections.join('\n\n---\n\n');
}
