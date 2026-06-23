/**
 * Improver Agent for Open CoDesign Multi-Agent System
 * Applies targeted improvements based on critique feedback
 */

import type { Artifact, GenerateOutput, ModelRef, StoredDesignSystem } from '@open-codesign/shared';
import type { CritiqueReport, Issue } from './critic-agent';

export interface ImproverInput {
  userPrompt: string;
  originalArtifact: Artifact;
  critique: CritiqueReport;
  designSystem?: StoredDesignSystem;
  model: ModelRef;
  apiKey: string;
  workspaceRoot: string;
}

export interface ImprovementPlan {
  priority_order: string[]; // issue IDs sorted by priority
  changes: PlannedChange[];
  estimated_iterations: number;
}

export interface PlannedChange {
  issue_id: string;
  issue_title: string;
  change_type: 'fix_critical' | 'improve_ux' | 'enhance_visual' | 'optimize_code';
  description: string;
  expected_impact: string;
}

/**
 * System prompt for Improver Agent
 */
const IMPROVER_SYSTEM_PROMPT = `
You are an improvement specialist for design refinement.

Your role: Apply targeted fixes based on structured critique feedback.

## Input You Receive
1. Original user prompt (what they asked for)
2. Generated design v1 (HTML/CSS/JS)
3. Structured critique report (scores, issues, suggestions)

## Your Task

### 1. Prioritize Issues
Address in this order:
- **Critical severity** first (breaks functionality, major accessibility violations)
- **High impact, low effort** next (quick wins with visible improvement)
- **High severity** third (significant UX problems, notable issues)
- **Medium/Low** only if time permits

Don't try to fix everything at once - focus on top 5-7 issues maximum.

### 2. Apply Improvements Systematically
- Fix one category at a time (accessibility → code quality → visual)
- Test mentally after each change
- Preserve what works well (don't break working features)
- Keep the same overall structure and layout

### 3. Maintain Design Coherence
- Use the SAME design system tokens (colors, typography, spacing)
- Keep the SAME HTML structure where possible
- Preserve the user's original intent
- Don't add features that weren't requested

### 4. Focus on Critique Feedback
- ONLY change what was criticized
- Don't "improve" things that weren't flagged as issues
- Address root causes, not just symptoms
- Follow fix suggestions from critique when provided

## Rules

✓ Fix critical accessibility issues first (contrast, labels, keyboard nav)
✓ Preserve user's original intent and requirements
✓ Keep improvements minimal and focused
✓ Use the same design tokens/style as v1
✓ Maintain HTML structure unless critique specifically calls out structure issues

✗ Don't over-engineer or add unnecessary complexity
✗ Don't add features the user didn't request
✗ Don't change things that weren't criticized
✗ Don't introduce new problems while fixing old ones
✗ Don't redesign from scratch - iterate on existing work

## Output

Produce improved HTML that:
1. Addresses the top priority issues from critique
2. Maintains the same overall design direction
3. Uses the same design system tokens
4. Fixes critical issues without breaking working features
5. Includes clear comments on what was changed and why

Add HTML comments at the top listing the improvements made:
<!--
IMPROVEMENTS APPLIED:
1. Fixed color contrast on button text (was 3.2:1, now 4.8:1)
2. Added missing form labels for accessibility
3. Improved heading hierarchy (h1 → h2 → h3)
4. Added hover states for interactive elements
5. Fixed responsive breakpoint at 768px
-->

## Improvement Strategy

For each issue in critique:

**Critical Issues (must fix):**
- Accessibility violations → add labels, improve contrast, fix keyboard nav
- Broken functionality → repair broken features, fix layout issues
- Major UX problems → clarify confusing interactions, fix navigation

**High Priority (should fix):**
- Notable accessibility gaps → add ARIA where needed, semantic HTML
- UX inconsistencies → standardize patterns, improve feedback
- Code quality issues → remove !important abuse, organize CSS

**Medium Priority (nice to fix):**
- Visual polish → adjust spacing, refine typography
- Minor UX improvements → add loading states, better error messages
- Performance → lazy load images, optimize CSS

**Low Priority (skip if time limited):**
- Code organization → comments, naming conventions
- Minor visual tweaks → small spacing adjustments
- Optimization → minification suggestions

Focus on critical and high priority. Only do medium/low if critique score is close to threshold (e.g., 80+ but needs polish).
`;

/**
 * Main Improver Agent function
 */
export async function improverAgent(input: ImproverInput): Promise<GenerateOutput> {
  const plan = buildImprovementPlan(input.critique);

  const userMessage = buildImproverPrompt(input, plan);

  // In real implementation, this would call generateViaAgent with the improvement context
  // For now, showing structure:

  /*
  return await generateViaAgent({
    prompt: userMessage,
    systemPrompt: IMPROVER_SYSTEM_PROMPT,
    model: input.model,
    apiKey: input.apiKey,
    workspaceRoot: input.workspaceRoot,
    designSystem: input.designSystem,
    history: []
  });
  */

  // Mock return for structure demonstration
  return {
    artifacts: [input.originalArtifact],
    costUsd: 0,
    tokensUsed: 0
  } as any;
}

/**
 * Build improvement plan from critique
 */
function buildImprovementPlan(critique: CritiqueReport): ImprovementPlan {
  const changes: PlannedChange[] = [];
  const priority_order: string[] = [];

  // Sort issues by severity and impact
  const sortedIssues = critique.critical_issues.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  // Take top 7 issues (manageable scope)
  const topIssues = sortedIssues.slice(0, 7);

  for (const issue of topIssues) {
    priority_order.push(issue.id);

    const changeType = categorizeChangeType(issue);

    changes.push({
      issue_id: issue.id,
      issue_title: issue.title,
      change_type: changeType,
      description: issue.description,
      expected_impact: issue.fix_suggestion || 'Improves overall quality'
    });
  }

  return {
    priority_order,
    changes,
    estimated_iterations: 1
  };
}

/**
 * Categorize issue into change type
 */
function categorizeChangeType(issue: Issue): PlannedChange['change_type'] {
  if (issue.severity === 'critical') {
    return 'fix_critical';
  }

  if (issue.category === 'accessibility' || issue.category === 'ux_patterns') {
    return 'improve_ux';
  }

  if (issue.category === 'visual_design') {
    return 'enhance_visual';
  }

  return 'optimize_code';
}

/**
 * Build prompt for improver with context
 */
function buildImproverPrompt(input: ImproverInput, plan: ImprovementPlan): string {
  const { userPrompt, originalArtifact, critique } = input;

  let prompt = `Apply targeted improvements to this design based on critique feedback.

## Original User Request
${userPrompt}

## Current Design (v1)
${originalArtifact.content}

## Critique Summary
Overall Score: ${critique.overall_score}/100

**Category Scores:**
- Visual Design: ${critique.categories.visual_design.score}/100
- UX Patterns: ${critique.categories.ux_patterns.score}/100
- Accessibility: ${critique.categories.accessibility.score}/100
- Code Quality: ${critique.categories.code_quality.score}/100
- Responsiveness: ${critique.categories.responsiveness.score}/100

## Issues to Address (Priority Order)

`;

  for (let i = 0; i < plan.changes.length; i++) {
    const change = plan.changes[i];
    const issue = critique.critical_issues.find(iss => iss.id === change.issue_id);

    if (issue) {
      prompt += `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.title}
   - ${issue.description}
   - Location: ${issue.location || 'General'}
   ${issue.fix_suggestion ? `   - How to fix: ${issue.fix_suggestion}` : ''}

`;
    }
  }

  prompt += `## Improvement Instructions

Apply fixes for the top ${plan.changes.length} issues listed above.

For each fix:
1. Make the specific change needed
2. Preserve surrounding code that works
3. Use the same design system tokens
4. Test mentally that the fix doesn't break anything

Add an HTML comment at the top listing what you fixed:
<!--
IMPROVEMENTS APPLIED:
1. [what you fixed and how]
2. [next fix]
...
-->

Focus on critical and high-priority issues. Don't redesign - just fix what's broken.
`;

  return prompt;
}

/**
 * Format improvement summary for display
 */
export function formatImprovementSummary(plan: ImprovementPlan): string {
  const lines = ['Improvement Plan:', ''];

  for (let i = 0; i < plan.changes.length; i++) {
    const change = plan.changes[i];
    lines.push(`${i + 1}. [${change.change_type}] ${change.issue_title}`);
    lines.push(`   ${change.description}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Check if improvements were successful
 */
export function assessImprovement(
  originalScore: number,
  improvedScore: number,
  threshold: number = 10
): { success: boolean; improvement: number; message: string } {
  const improvement = improvedScore - originalScore;

  if (improvement >= threshold) {
    return {
      success: true,
      improvement,
      message: `Significant improvement: ${originalScore} → ${improvedScore} (+${improvement} points)`
    };
  } else if (improvement > 0) {
    return {
      success: true,
      improvement,
      message: `Modest improvement: ${originalScore} → ${improvedScore} (+${improvement} points)`
    };
  } else {
    return {
      success: false,
      improvement,
      message: `No improvement: ${originalScore} → ${improvedScore}`
    };
  }
}
