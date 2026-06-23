/**
 * Critic Agent for Open CoDesign Multi-Agent System
 * Analyzes generated designs and provides structured feedback
 */

import type { Artifact, ModelRef, StoredDesignSystem } from '@open-codesign/shared';

export interface CritiqueReport {
  overall_score: number; // 0-100
  timestamp: string;
  categories: {
    visual_design: CategoryCritique;
    ux_patterns: CategoryCritique;
    accessibility: CategoryCritique;
    code_quality: CategoryCritique;
    responsiveness: CategoryCritique;
  };
  critical_issues: Issue[];
  improvement_suggestions: Suggestion[];
  positive_aspects: string[];
}

export interface CategoryCritique {
  score: number; // 0-100
  passed_checks: string[];
  failed_checks: FailedCheck[];
  recommendations: string[];
}

export interface FailedCheck {
  check_name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location?: string;
}

export interface Issue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  location?: string;
  fix_suggestion?: string;
}

export interface Suggestion {
  priority: 'high' | 'medium' | 'low';
  category: string;
  suggestion: string;
  impact: string;
}

export interface CriticInput {
  userPrompt: string;
  artifact: Artifact;
  designSystem?: StoredDesignSystem;
  model: ModelRef;
  apiKey: string;
}

/**
 * System prompt for Critic Agent
 */
const CRITIC_SYSTEM_PROMPT = `
You are a senior design critic with 10+ years of experience reviewing UI/UX designs.

Your task: Analyze generated designs objectively and provide structured feedback.

## Evaluation Criteria

### Visual Design (0-100)
Assess:
- Typography: hierarchy clarity, readability, font choices, sizing consistency
- Color: palette harmony, purpose, sufficient contrast, semantic use
- Spacing: rhythm consistency, white space usage, cramped vs. generous
- Hierarchy: visual priority clear, scannable, most important stands out

Scoring:
- 90-100: Excellent, polished, publication-ready
- 75-89: Good, minor improvements needed
- 60-74: Adequate, notable issues present
- 40-59: Below standard, major rework required
- 0-39: Poor, fundamental problems

### UX Patterns (0-100)
Assess:
- Usability: intuitive interactions, follows conventions
- Consistency: predictable patterns throughout
- Mental models: matches user expectations
- Task completion: logical flow, efficient paths

### Accessibility (0-100)
Assess:
- WCAG compliance: A, AA, or AAA level
- Keyboard navigation: tab order, focus indicators, shortcuts
- Screen readers: semantic HTML, ARIA labels, announcements
- Color contrast: text readability (4.5:1 for normal, 3:1 for large)
- Touch targets: 44×44px minimum on mobile

### Code Quality (0-100)
Assess:
- HTML: semantic elements, valid structure, organized
- CSS: maintainable, no anti-patterns, efficient
- Structure: clean, no unnecessary complexity, DRY principle
- Performance: optimized, lazy loading, minimal bloat

### Responsiveness (0-100)
Assess:
- Mobile (375px): works properly, readable, functional
- Tablet (768px): adapts gracefully, layout shifts appropriately
- Desktop (1440px): uses space well, not stretched thin
- Touch targets: adequate size for mobile interaction

## AI-Generated Design Tells to Flag

Common issues in AI-generated designs:
- Generic color palette (#6366f1 indigo, #8b5cf6 purple everywhere)
- Gratuitous gradients with no functional purpose
- Overuse of shadows and blur effects
- Lorem ipsum or generic placeholder copy
- Missing hover/focus/active states
- No empty/error/loading states
- Inaccessible color combinations (insufficient contrast)
- No mobile optimization or responsive behavior

## Output Format

Return structured JSON matching the CritiqueReport interface:
{
  "overall_score": 0-100,
  "timestamp": "ISO 8601",
  "categories": {
    "visual_design": { "score": 0-100, "passed_checks": [...], "failed_checks": [...], "recommendations": [...] },
    "ux_patterns": { ... },
    "accessibility": { ... },
    "code_quality": { ... },
    "responsiveness": { ... }
  },
  "critical_issues": [
    { "id": "unique-id", "severity": "critical|high|medium|low", "category": "...", "title": "...", "description": "...", "location": "...", "fix_suggestion": "..." }
  ],
  "improvement_suggestions": [
    { "priority": "high|medium|low", "category": "...", "suggestion": "...", "impact": "..." }
  ],
  "positive_aspects": ["What was done well", "Another good thing", ...]
}

## Analysis Approach

1. **Be objective** - not personal taste, but industry standards
2. **Be specific** - cite exact issues with locations in code
3. **Be actionable** - explain how to fix, not just what's wrong
4. **Be prioritized** - critical → high → medium → low severity
5. **Be balanced** - note positive aspects, not just problems

## Severity Definitions

- **Critical**: Breaks functionality, major accessibility violation, unusable
- **High**: Significant UX problem, notable accessibility issue, poor code practice
- **Medium**: Improvement opportunity, minor accessibility gap, style inconsistency
- **Low**: Nice-to-have, polish item, optimization opportunity

Be honest but constructive. The goal is improvement, not discouragement.
Rate strictly - reserve 90+ for truly excellent work.
`;

/**
 * Main Critic Agent function
 */
export async function criticAgent(input: CriticInput): Promise<CritiqueReport> {
  // This would use the actual completeWithRetry from @open-codesign/providers
  // For now, providing the structure

  const userMessage = buildCriticPrompt(input);

  // In real implementation:
  // const response = await completeWithRetry(input.model, messages, { responseFormat: 'json_object' });
  // const critique = JSON.parse(response.content) as CritiqueReport;

  // For now, return mock structure to show interface
  const critique: CritiqueReport = {
    overall_score: 0,
    timestamp: new Date().toISOString(),
    categories: {
      visual_design: { score: 0, passed_checks: [], failed_checks: [], recommendations: [] },
      ux_patterns: { score: 0, passed_checks: [], failed_checks: [], recommendations: [] },
      accessibility: { score: 0, passed_checks: [], failed_checks: [], recommendations: [] },
      code_quality: { score: 0, passed_checks: [], failed_checks: [], recommendations: [] },
      responsiveness: { score: 0, passed_checks: [], failed_checks: [], recommendations: [] }
    },
    critical_issues: [],
    improvement_suggestions: [],
    positive_aspects: []
  };

  return validateAndEnrichCritique(critique);
}

/**
 * Build prompt for critic with context
 */
function buildCriticPrompt(input: CriticInput): string {
  const { userPrompt, artifact, designSystem } = input;

  let prompt = `Analyze this design critically and provide structured feedback.

## Original User Request
${userPrompt}

## Generated Design (HTML)
${artifact.content.substring(0, 15000)}${artifact.content.length > 15000 ? '\n... (truncated for length)' : ''}
`;

  if (designSystem) {
    prompt += `\n## Design System Context
Active design system tokens and guidelines:
${formatDesignSystem(designSystem)}
`;
  }

  prompt += `\nProvide comprehensive critique as JSON following CritiqueReport structure.
Focus on:
1. Does it meet the user's requirements?
2. Is the visual design polished and professional?
3. Are UX patterns intuitive and consistent?
4. Is it accessible (WCAG AA minimum)?
5. Is the code clean and maintainable?
6. Is it responsive (mobile to desktop)?

Be specific about what to improve and how.
`;

  return prompt;
}

/**
 * Format design system for prompt
 */
function formatDesignSystem(designSystem: StoredDesignSystem): string {
  // Extract key information from design system
  const content = designSystem.content || '';

  // Get first 500 characters of each major section
  const sections = ['Colors', 'Typography', 'Spacing', 'Components'];
  let formatted = '';

  for (const section of sections) {
    const sectionRegex = new RegExp(`##\\s*${section}([\\s\\S]{0,500})`, 'i');
    const match = content.match(sectionRegex);
    if (match) {
      formatted += `### ${section}\n${match[1].trim()}\n\n`;
    }
  }

  return formatted || content.substring(0, 1000);
}

/**
 * Validate and enrich critique report
 */
function validateAndEnrichCritique(critique: CritiqueReport): CritiqueReport {
  // Ensure all required fields are present
  if (!critique.timestamp) {
    critique.timestamp = new Date().toISOString();
  }

  // Calculate overall score if not provided
  if (critique.overall_score === 0 && critique.categories) {
    const scores = Object.values(critique.categories).map(cat => cat.score);
    critique.overall_score = Math.round(
      scores.reduce((sum, score) => sum + score, 0) / scores.length
    );
  }

  // Sort issues by severity
  if (critique.critical_issues) {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    critique.critical_issues.sort((a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity]
    );
  }

  // Sort suggestions by priority
  if (critique.improvement_suggestions) {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    critique.improvement_suggestions.sort((a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  return critique;
}

/**
 * Extract key recommendations from critique
 */
export function extractTopRecommendations(
  critique: CritiqueReport,
  limit: number = 5
): string[] {
  const recommendations: string[] = [];

  // Add critical issues first
  const critical = critique.critical_issues
    .filter(issue => issue.severity === 'critical' || issue.severity === 'high')
    .slice(0, 3)
    .map(issue => `${issue.title}: ${issue.description}`);

  recommendations.push(...critical);

  // Add high-priority suggestions
  const suggestions = critique.improvement_suggestions
    .filter(sug => sug.priority === 'high')
    .slice(0, limit - critical.length)
    .map(sug => sug.suggestion);

  recommendations.push(...suggestions);

  return recommendations.slice(0, limit);
}

/**
 * Check if critique passes threshold for skipping improvement
 */
export function shouldSkipImprovement(
  critique: CritiqueReport,
  threshold: number = 85
): boolean {
  return critique.overall_score >= threshold &&
         critique.critical_issues.filter(i => i.severity === 'critical').length === 0;
}
