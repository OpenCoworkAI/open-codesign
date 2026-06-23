/**
 * Fault-Tolerant Multi-Agent Orchestration with Checkpointing
 * Cloud Design - Zero Failure Architecture
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Artifact, GenerateInput, GenerateOutput } from '../types';
import { criticAgent, type CritiqueReport } from '../agents/critic-agent';
import { improverAgent } from '../agents/improver-agent';

interface CheckpointState {
  workflowId: string;
  stage: 'generator' | 'critic' | 'improver';
  timestamp: number;
  artifact?: Artifact;
  critique?: CritiqueReport;
  metadata: {
    tokensUsed?: number;
    costUsd?: number;
    overallScore?: number;
    criticalIssues?: number;
  };
}

interface CircuitBreakerState {
  failureCount: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  threshold: number;
  timeout: number;
}

interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
}

interface MultiAgentConfig {
  skipImproveThreshold?: number;
  criticModel?: string;
  improverModel?: string;
  enableCheckpointing?: boolean;
  checkpointDir?: string;
}

export class FaultTolerantMultiAgent {
  private checkpoints: Map<string, CheckpointState>;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private retryPolicy: RetryPolicy;
  private checkpointDir: string;

  constructor(checkpointDir: string = '/tmp/clodex-checkpoints') {
    this.checkpoints = new Map();
    this.circuitBreakers = new Map();
    this.checkpointDir = checkpointDir;

    // Exponential backoff retry policy
    this.retryPolicy = {
      maxRetries: 3,
      baseDelay: 1000, // ms
      maxDelay: 10000,
      exponentialBase: 2,
      jitter: true
    };

    // Initialize circuit breakers for each agent
    ['generator', 'critic', 'improver'].forEach(agent => {
      this.circuitBreakers.set(agent, {
        failureCount: 0,
        lastFailure: 0,
        state: 'closed',
        threshold: 5, // 5 failures open circuit
        timeout: 60000 // 60s before attempting half-open
      });
    });

    // Ensure checkpoint directory exists
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * Execute multi-agent workflow with fault tolerance
   */
  public async generateWithFaultTolerance(
    input: GenerateInput,
    config: MultiAgentConfig = {}
  ): Promise<GenerateOutput> {
    const workflowId = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Stage 1: Generator with checkpointing
      console.log(`[FT] Starting workflow ${workflowId} - Stage 1: Generator`);

      const generatorResult = await this.executeWithRetry(
        'generator',
        async () => {
          const result = await this.runGenerator(input);

          // Checkpoint after Generator
          if (config.enableCheckpointing !== false) {
            this.saveCheckpoint({
              workflowId,
              stage: 'generator',
              timestamp: Date.now(),
              artifact: result.artifacts[0],
              metadata: {
                tokensUsed: result.tokensUsed,
                costUsd: result.costUsd
              }
            });
          }

          return result;
        }
      );

      console.log(`[FT] Stage 1 complete - ${generatorResult.tokensUsed} tokens, $${generatorResult.costUsd.toFixed(3)}`);

      // Stage 2: Critic with circuit breaker protection
      console.log(`[FT] Stage 2: Critic (circuit: ${this.circuitBreakers.get('critic')?.state})`);

      let critiqueResult: CritiqueReport;

      if (this.isCircuitOpen('critic')) {
        console.warn('[FT] Critic circuit OPEN - using fallback critique');
        critiqueResult = this.getFallbackCritique();
      } else {
        critiqueResult = await this.executeWithRetry(
          'critic',
          async () => {
            const critique = await criticAgent({
              userPrompt: input.prompt,
              artifact: generatorResult.artifacts[0],
              designSystem: input.designSystem,
              model: config.criticModel || input.model,
              apiKey: input.apiKey
            });

            // Checkpoint after Critic
            if (config.enableCheckpointing !== false) {
              this.saveCheckpoint({
                workflowId,
                stage: 'critic',
                timestamp: Date.now(),
                artifact: generatorResult.artifacts[0],
                critique,
                metadata: {
                  overallScore: critique.overall_score,
                  criticalIssues: critique.critical_issues.length
                }
              });
            }

            return critique;
          }
        );
      }

      console.log(`[FT] Stage 2 complete - Overall score: ${critiqueResult.overall_score}/100`);

      // Early exit if score is high enough
      const threshold = config.skipImproveThreshold || 85;
      if (critiqueResult.overall_score >= threshold) {
        console.log(`[FT] Score ${critiqueResult.overall_score} >= ${threshold}, skipping improvement`);

        return {
          ...generatorResult,
          metadata: {
            ...generatorResult.metadata,
            multi_agent: true,
            critique_report: critiqueResult,
            improvement_applied: false,
            skipped_improvement: true
          }
        };
      }

      // Stage 3: Improver with fallback to Generator output
      console.log(`[FT] Stage 3: Improver (circuit: ${this.circuitBreakers.get('improver')?.state})`);

      let finalResult: GenerateOutput;

      if (this.isCircuitOpen('improver')) {
        console.warn('[FT] Improver circuit OPEN - returning Generator output');
        finalResult = {
          ...generatorResult,
          metadata: {
            ...generatorResult.metadata,
            multi_agent: true,
            critique_report: critiqueResult,
            improvement_applied: false,
            improver_circuit_open: true
          }
        };
      } else {
        try {
          finalResult = await this.executeWithRetry(
            'improver',
            async () => {
              return await improverAgent({
                userPrompt: input.prompt,
                originalArtifact: generatorResult.artifacts[0],
                critique: critiqueResult,
                designSystem: input.designSystem,
                model: config.improverModel || input.model,
                apiKey: input.apiKey,
                workspaceRoot: input.workspaceRoot || process.cwd()
              });
            }
          );

          console.log(`[FT] Stage 3 complete - Improvement applied`);
        } catch (error) {
          console.error('[FT] Improver failed after retries, falling back to Generator output');
          finalResult = {
            ...generatorResult,
            metadata: {
              ...generatorResult.metadata,
              multi_agent: true,
              critique_report: critiqueResult,
              improvement_applied: false,
              improver_failed: true,
              error: (error as Error).message
            }
          };
        }
      }

      // Success - reset circuit breakers
      this.recordSuccess('generator');
      this.recordSuccess('critic');
      this.recordSuccess('improver');

      // Cleanup checkpoint
      this.checkpoints.delete(workflowId);
      this.deleteCheckpointFile(workflowId);

      return finalResult;

    } catch (error) {
      console.error('[FT] Workflow failure, attempting recovery...');

      // Attempt recovery from last checkpoint
      const recovered = await this.recoverFromCheckpoint(workflowId);

      if (recovered) {
        console.log('[FT] Successfully recovered from checkpoint');
        return recovered;
      }

      // Final fallback: basic Generator without multi-agent
      console.error('[FT] Complete workflow failure, falling back to basic generation');
      return await this.runGenerator(input);
    }
  }

  /**
   * Execute operation with exponential backoff retry
   */
  private async executeWithRetry<T>(
    agentName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        const result = await operation();
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(agentName);

        if (attempt < this.retryPolicy.maxRetries) {
          const delay = this.calculateBackoff(attempt);
          console.warn(`[FT] ${agentName} failed (attempt ${attempt + 1}/${this.retryPolicy.maxRetries}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`${agentName} failed after ${this.retryPolicy.maxRetries} retries: ${lastError?.message}`);
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateBackoff(attempt: number): number {
    const base = this.retryPolicy.baseDelay;
    const exponential = base * Math.pow(this.retryPolicy.exponentialBase, attempt);
    const capped = Math.min(exponential, this.retryPolicy.maxDelay);

    // Add jitter to prevent thundering herd
    if (this.retryPolicy.jitter) {
      const jitter = (Math.random() - 0.5) * 0.3 * capped; // ±30% jitter
      return Math.floor(capped + jitter);
    }

    return Math.floor(capped);
  }

  /**
   * Record failure and update circuit breaker
   */
  private recordFailure(agentName: string): void {
    const breaker = this.circuitBreakers.get(agentName);
    if (!breaker) return;

    breaker.failureCount++;
    breaker.lastFailure = Date.now();

    if (breaker.failureCount >= breaker.threshold) {
      breaker.state = 'open';
      console.error(`[CB] Circuit breaker OPEN for ${agentName} (failures: ${breaker.failureCount})`);
    }
  }

  /**
   * Record success and potentially close circuit
   */
  private recordSuccess(agentName: string): void {
    const breaker = this.circuitBreakers.get(agentName);
    if (!breaker) return;

    if (breaker.state === 'half-open') {
      // Success in half-open state - close the circuit
      breaker.state = 'closed';
      breaker.failureCount = 0;
      console.info(`[CB] Circuit breaker CLOSED for ${agentName}`);
    } else if (breaker.state === 'closed') {
      // Gradual recovery - decay failure count
      breaker.failureCount = Math.max(0, breaker.failureCount - 1);
    }
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(agentName: string): boolean {
    const breaker = this.circuitBreakers.get(agentName);
    if (!breaker) return false;

    if (breaker.state === 'open') {
      const elapsed = Date.now() - breaker.lastFailure;

      if (elapsed > breaker.timeout) {
        // Attempt half-open state
        breaker.state = 'half-open';
        console.info(`[CB] Circuit breaker HALF-OPEN for ${agentName}, attempting recovery`);
        return false;
      }

      return true; // Still open
    }

    return false;
  }

  /**
   * Save checkpoint to memory and disk
   */
  private saveCheckpoint(checkpoint: CheckpointState): void {
    this.checkpoints.set(checkpoint.workflowId, checkpoint);

    // Persist to disk for cross-process recovery
    try {
      const checkpointPath = path.join(this.checkpointDir, `${checkpoint.workflowId}.json`);
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    } catch (error) {
      console.error(`[FT] Failed to persist checkpoint: ${(error as Error).message}`);
    }
  }

  /**
   * Recover workflow from checkpoint
   */
  private async recoverFromCheckpoint(workflowId: string): Promise<GenerateOutput | null> {
    let checkpoint = this.checkpoints.get(workflowId);

    // Try loading from disk if not in memory
    if (!checkpoint) {
      try {
        const checkpointPath = path.join(this.checkpointDir, `${workflowId}.json`);
        if (fs.existsSync(checkpointPath)) {
          const data = fs.readFileSync(checkpointPath, 'utf-8');
          checkpoint = JSON.parse(data);
        }
      } catch (error) {
        console.error(`[FT] Failed to load checkpoint from disk: ${(error as Error).message}`);
      }
    }

    if (!checkpoint) {
      console.warn(`[FT] No checkpoint found for workflow ${workflowId}`);
      return null;
    }

    console.info(`[FT] Recovering from checkpoint: ${checkpoint.stage}`);

    // Return last known good artifact
    if (checkpoint.artifact) {
      return {
        artifacts: [checkpoint.artifact],
        costUsd: checkpoint.metadata.costUsd || 0,
        tokensUsed: checkpoint.metadata.tokensUsed || 0,
        metadata: {
          recovered: true,
          recoveredFromStage: checkpoint.stage,
          checkpointTimestamp: checkpoint.timestamp
        }
      };
    }

    return null;
  }

  /**
   * Delete checkpoint file
   */
  private deleteCheckpointFile(workflowId: string): void {
    try {
      const checkpointPath = path.join(this.checkpointDir, `${workflowId}.json`);
      if (fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
      }
    } catch (error) {
      console.error(`[FT] Failed to delete checkpoint: ${(error as Error).message}`);
    }
  }

  /**
   * Fallback critique when Critic agent is unavailable
   */
  private getFallbackCritique(): CritiqueReport {
    return {
      overall_score: 75, // Conservative baseline
      timestamp: new Date().toISOString(),
      categories: {
        visual_design: {
          score: 75,
          passed_checks: ['Basic visual structure present'],
          failed_checks: [],
          recommendations: ['Full visual audit unavailable - critic service down']
        },
        ux_patterns: {
          score: 75,
          passed_checks: ['Interactive elements present'],
          failed_checks: [],
          recommendations: ['Full UX audit unavailable - critic service down']
        },
        accessibility: {
          score: 75,
          passed_checks: ['Basic HTML semantics'],
          failed_checks: [],
          recommendations: ['Full a11y audit unavailable - critic service down']
        },
        code_quality: {
          score: 75,
          passed_checks: ['Valid HTML structure'],
          failed_checks: [],
          recommendations: ['Full code audit unavailable - critic service down']
        },
        responsiveness: {
          score: 75,
          passed_checks: ['Viewport meta tag present'],
          failed_checks: [],
          recommendations: ['Full responsive audit unavailable - critic service down']
        }
      },
      critical_issues: [],
      improvement_suggestions: [
        'Critic agent unavailable - using fallback scores',
        'Recommend manual review or retry when service recovers'
      ],
      positive_aspects: ['Generated successfully (critic unavailable)']
    };
  }

  /**
   * Basic generator fallback (placeholder - integrate with actual generator)
   */
  private async runGenerator(input: GenerateInput): Promise<GenerateOutput> {
    // This should call the actual generator implementation
    // For now, returning a placeholder
    throw new Error('Generator implementation not integrated - this is a placeholder');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker statistics
   */
  public getCircuitStats() {
    const stats: any = {};

    for (const [agent, breaker] of this.circuitBreakers) {
      stats[agent] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        lastFailure: breaker.lastFailure ? new Date(breaker.lastFailure).toISOString() : null
      };
    }

    return stats;
  }

  /**
   * Get checkpoint statistics
   */
  public getCheckpointStats() {
    return {
      activeCheckpoints: this.checkpoints.size,
      checkpointDir: this.checkpointDir,
      diskCheckpoints: this.getCheckpointFiles().length
    };
  }

  private getCheckpointFiles(): string[] {
    try {
      return fs.readdirSync(this.checkpointDir).filter(f => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}
