/**
 * Multi-Agent Orchestration for Open CoDesign
 * Coordinates Generator → Critic → Improver workflow
 */

import type { GenerateInput, GenerateOutput, ModelRef } from '@open-codesign/shared';
import { criticAgent, type CritiqueReport, shouldSkipImprovement } from './critic-agent';
import { improverAgent, formatImprovementSummary, assessImprovement } from './improver-agent';

export interface MultiAgentConfig {
  enableCritic: boolean;           // default: true
  enableImprover: boolean;          // default: true
  skipImproveThreshold: number;    // default: 85 (0-100)
  maxIterations: number;           // default: 1 (future: support multiple rounds)
  criticModel?: ModelRef;          // optional separate model for critic
  improverModel?: ModelRef;        // optional separate model for improver
}

export const DEFAULT_MULTI_AGENT_CONFIG: MultiAgentConfig = {
  enableCritic: true,
  enableImprover: true,
  skipImproveThreshold: 85,
  maxIterations: 1
};

export interface MultiAgentMetadata {
  multi_agent: true;
  generator_version?: GenerateOutput;
  critique_report?: CritiqueReport;
  improvement_applied: boolean;
  skipped_improvement?: boolean;
  total_time_ms: number;
  cost_breakdown: {
    generator: number;
    critic: number;
    improver: number;
    total: number;
  };
}

/**
 * Main multi-agent generation function
 */
export async function generateWithMultiAgent(
  input: GenerateInput,
  config: MultiAgentConfig = DEFAULT_MULTI_AGENT_CONFIG
): Promise<GenerateOutput & { metadata?: MultiAgentMetadata }> {

  const startTime = Date.now();
  let generatorCost = 0;
  let criticCost = 0;
  let improverCost = 0;

  console.log('[multi-agent] Starting multi-agent generation...');

  // Step 1: Generator - create first version
  console.log('[multi-agent] Step 1/3: Generator...');
  const v1 = await generateViaAgent(input);
  generatorCost = v1.costUsd || 0;

  console.log(`[multi-agent] Generator complete. Cost: $${generatorCost.toFixed(4)}`);

  // Skip critic if disabled or no artifact generated
  if (!config.enableCritic || !v1.artifacts || v1.artifacts.length === 0) {
    console.log('[multi-agent] Critic disabled or no artifacts - returning v1');
    return {
      ...v1,
      metadata: {
        multi_agent: true,
        improvement_applied: false,
        total_time_ms: Date.now() - startTime,
        cost_breakdown: {
          generator: generatorCost,
          critic: 0,
          improver: 0,
          total: generatorCost
        }
      }
    };
  }

  // Step 2: Critic - analyze design
  console.log('[multi-agent] Step 2/3: Critic analyzing design...');
  const critique = await criticAgent({
    userPrompt: input.prompt,
    artifact: v1.artifacts[0],
    designSystem: input.designSystem,
    model: config.criticModel || input.model,
    apiKey: input.apiKey || ''
  });

  criticCost = 0.01; // Estimate for analysis (typically much cheaper than generation)

  console.log(`[multi-agent] Critic complete. Score: ${critique.overall_score}/100`);
  console.log(`[multi-agent] Critical issues: ${critique.critical_issues.filter(i => i.severity === 'critical').length}`);

  // Check if score is high enough to skip improvement
  if (shouldSkipImprovement(critique, config.skipImproveThreshold)) {
    console.log(`[multi-agent] Score ${critique.overall_score} >= threshold ${config.skipImproveThreshold}, skipping improver`);
    return {
      ...v1,
      metadata: {
        multi_agent: true,
        critique_report: critique,
        improvement_applied: false,
        skipped_improvement: true,
        total_time_ms: Date.now() - startTime,
        cost_breakdown: {
          generator: generatorCost,
          critic: criticCost,
          improver: 0,
          total: generatorCost + criticCost
        }
      }
    };
  }

  // Skip improver if disabled
  if (!config.enableImprover) {
    console.log('[multi-agent] Improver disabled - returning v1 with critique');
    return {
      ...v1,
      metadata: {
        multi_agent: true,
        critique_report: critique,
        improvement_applied: false,
        total_time_ms: Date.now() - startTime,
        cost_breakdown: {
          generator: generatorCost,
          critic: criticCost,
          improver: 0,
          total: generatorCost + criticCost
        }
      }
    };
  }

  // Step 3: Improver - apply fixes
  console.log('[multi-agent] Step 3/3: Improver applying fixes...');
  const v2 = await improverAgent({
    userPrompt: input.prompt,
    originalArtifact: v1.artifacts[0],
    critique: critique,
    designSystem: input.designSystem,
    model: config.improverModel || input.model,
    apiKey: input.apiKey || '',
    workspaceRoot: input.workspaceRoot || process.cwd()
  });

  improverCost = v2.costUsd || 0;

  const totalTime = Date.now() - startTime;
  const totalCost = generatorCost + criticCost + improverCost;

  console.log(`[multi-agent] Improver complete. Cost: $${improverCost.toFixed(4)}`);
  console.log(`[multi-agent] Total time: ${totalTime}ms, Total cost: $${totalCost.toFixed(4)}`);

  return {
    ...v2,
    metadata: {
      multi_agent: true,
      generator_version: v1,
      critique_report: critique,
      improvement_applied: true,
      total_time_ms: totalTime,
      cost_breakdown: {
        generator: generatorCost,
        critic: criticCost,
        improver: improverCost,
        total: totalCost
      }
    }
  };
}

/**
 * Mock generateViaAgent for demonstration
 * In real implementation, this imports from ../agent.ts
 */
async function generateViaAgent(input: GenerateInput): Promise<GenerateOutput> {
  // This is a placeholder - real implementation would call the actual generateViaAgent
  throw new Error('generateViaAgent must be imported from ../agent.ts');
}

/**
 * Format multi-agent metadata for display
 */
export function formatMultiAgentSummary(metadata: MultiAgentMetadata): string {
  const lines: string[] = [];

  lines.push('=== Multi-Agent Generation Summary ===');
  lines.push('');

  if (metadata.critique_report) {
    lines.push(`Quality Score: ${metadata.critique_report.overall_score}/100`);
    lines.push('');
    lines.push('Category Scores:');
    lines.push(`  Visual Design:   ${metadata.critique_report.categories.visual_design.score}/100`);
    lines.push(`  UX Patterns:     ${metadata.critique_report.categories.ux_patterns.score}/100`);
    lines.push(`  Accessibility:   ${metadata.critique_report.categories.accessibility.score}/100`);
    lines.push(`  Code Quality:    ${metadata.critique_report.categories.code_quality.score}/100`);
    lines.push(`  Responsiveness:  ${metadata.critique_report.categories.responsiveness.score}/100`);
    lines.push('');
  }

  lines.push(`Improvement Applied: ${metadata.improvement_applied ? 'Yes' : 'No'}`);
  if (metadata.skipped_improvement) {
    lines.push('(Score exceeded threshold - improvements not needed)');
  }
  lines.push('');

  lines.push(`Time: ${(metadata.total_time_ms / 1000).toFixed(1)}s`);
  lines.push('');

  lines.push('Cost Breakdown:');
  lines.push(`  Generator: $${metadata.cost_breakdown.generator.toFixed(4)}`);
  lines.push(`  Critic:    $${metadata.cost_breakdown.critic.toFixed(4)}`);
  lines.push(`  Improver:  $${metadata.cost_breakdown.improver.toFixed(4)}`);
  lines.push(`  Total:     $${metadata.cost_breakdown.total.toFixed(4)}`);
  lines.push('');

  if (metadata.critique_report && metadata.critique_report.critical_issues.length > 0) {
    lines.push('Top Issues Found:');
    const topIssues = metadata.critique_report.critical_issues.slice(0, 3);
    for (let i = 0; i < topIssues.length; i++) {
      const issue = topIssues[i];
      lines.push(`  ${i + 1}. [${issue.severity}] ${issue.title}`);
    }
  }

  return lines.join('\n');
}

/**
 * Estimate cost for multi-agent generation
 */
export function estimateMultiAgentCost(
  singleAgentCost: number,
  config: MultiAgentConfig
): { min: number; max: number; average: number } {
  const generatorCost = singleAgentCost;
  const criticCost = singleAgentCost * 0.1; // Critic is ~10% (analysis only, no generation)
  const improverCost = singleAgentCost; // Improver regenerates, similar cost

  if (!config.enableCritic) {
    return { min: generatorCost, max: generatorCost, average: generatorCost };
  }

  if (!config.enableImprover) {
    const total = generatorCost + criticCost;
    return { min: total, max: total, average: total };
  }

  // With improver, depends on whether threshold is met
  const minCost = generatorCost + criticCost; // If score passes threshold
  const maxCost = generatorCost + criticCost + improverCost; // If improvement needed
  const avgCost = (minCost + maxCost) / 2;

  return { min: minCost, max: maxCost, average: avgCost };
}
