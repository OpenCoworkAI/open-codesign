/**
 * System prompt composer for open-codesign.
 *
 * Prompt text lives in `sections/*.md` and is loaded once at module init by
 * `sections/loader.ts`. Compose logic is split across sibling files:
 *   - compose-full.ts                — full (pre-disclosure) mode
 *   - compose-create-progressive.ts  — keyword-routed progressive disclosure
 *   - plan-keywords.ts               — keyword → section plan
 *   - craft-block.ts                 — craft-directives subsection splitter
 *
 * This file stays thin: it picks the assembly strategy based on `mode` and
 * `userPrompt`, then joins the result.
 */

import { composeCreateProgressive } from './compose-create-progressive.js';
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
   * The user's prompt — used for keyword-based progressive disclosure of
   * craft directives, chart rendering, and starter templates. Optional for
   * back-compat: when omitted the full (pre-disclosure) prompt is returned.
   */
  userPrompt?: string | undefined;
  /** Additional skill blobs to append (future extension point). */
  skills?: string[] | undefined;
}

/**
 * Assembles the system prompt from section constants according to the requested
 * generation mode.
 *
 * Two modes of assembly:
 *
 * 1. **Full** (default — when `userPrompt` is undefined, or mode is `tweak` /
 *    `revise`). Order:
 *      identity → workflow → output-rules → design-methodology →
 *      artifact-types → pre-flight → editmode-protocol →
 *      [tweaks-protocol if mode === 'tweak'] →
 *      craft-directives → chart-rendering →
 *      [ios-starter-template if mode === 'create'] →
 *      anti-slop → safety → [skill blobs if any]
 *
 * 2. **Progressive** (mode === 'create' AND `userPrompt` provided). See
 *    `compose-create-progressive.ts` for the layer breakdown.
 *
 * Brand tokens and other user-filesystem data are intentionally excluded here.
 * They are passed as untrusted user-role content in the message array to prevent
 * prompt injection attacks from adversarial codebase content.
 */
export function composeSystemPrompt(opts: PromptComposeOptions): string {
  const sections =
    opts.userPrompt !== undefined && opts.mode === 'create'
      ? composeCreateProgressive(opts.userPrompt)
      : composeFull(opts.mode);

  if (opts.skills?.length) {
    const header = [
      '# Available Skills',
      '',
      "You have access to these specialized skills. Use the one that best fits the user's request — multiple skills can apply if the request spans domains.",
    ].join('\n');
    sections.push(`${header}\n\n---\n\n${opts.skills.join('\n\n---\n\n')}`);
  }

  return sections.join('\n\n---\n\n');
}
