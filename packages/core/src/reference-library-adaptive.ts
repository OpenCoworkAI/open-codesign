/**
 * Adaptive Reference Library with Automatic Quality Feedback Loop
 * Cloud Design - Self-Improving Example System
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReferenceExample {
  id: string;
  name: string;
  category: string;
  description: string;
  html: string;
  css: string;
  js?: string;
  metadata: ReferenceMetadata;
  qualityMetrics: QualityMetrics;
  version: number;
  lastUpdated: string;
}

export interface ReferenceMetadata {
  framework?: string;
  tags: string[];
  complexity: 'simple' | 'medium' | 'complex';
  designPattern: string;
  accessibility: string; // WCAG level
  responsive: boolean;
  darkMode: boolean;
  rtl: boolean;
}

export interface QualityMetrics {
  usageCount: number;
  avgQualityScore: number;
  avgAccessibilityScore: number;
  avgPerformanceScore: number;
  successRate: number; // % of times used successfully
  lastUsed: string;
  reportedIssues: number;
}

export interface FeedbackData {
  exampleId: string;
  qualityScore: number;
  accessibilityScore: number;
  performanceScore: number;
  userPrompt: string;
  timestamp: string;
  issues?: string[];
}

export class AdaptiveReferenceLibrary {
  private libraryPath: string;
  private examples: Map<string, ReferenceExample>;
  private feedbackQueue: FeedbackData[];
  private updateThreshold: number;

  constructor(libraryPath: string = './references') {
    this.libraryPath = libraryPath;
    this.examples = new Map();
    this.feedbackQueue = [];
    this.updateThreshold = 10; // Trigger update after 10 uses

    this.loadLibrary();
  }

  /**
   * Load reference library from disk
   */
  private loadLibrary(): void {
    const examplesPath = path.join(this.libraryPath, 'examples');

    if (!fs.existsSync(examplesPath)) {
      console.warn('[RefLib] Examples directory not found, creating...');
      fs.mkdirSync(examplesPath, { recursive: true });
      this.seedInitialExamples();
      return;
    }

    const categories = fs.readdirSync(examplesPath);

    categories.forEach(category => {
      const categoryPath = path.join(examplesPath, category);
      if (!fs.statSync(categoryPath).isDirectory()) return;

      const examples = fs.readdirSync(categoryPath).filter(f => f.endsWith('.json'));

      examples.forEach(file => {
        try {
          const examplePath = path.join(categoryPath, file);
          const data = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
          this.examples.set(data.id, data);
        } catch (error) {
          console.error(`[RefLib] Failed to load ${file}:`, error);
        }
      });
    });

    console.log(`[RefLib] Loaded ${this.examples.size} reference examples`);
  }

  /**
   * Find best reference examples for a given prompt
   */
  public findRelevantExamples(
    userPrompt: string,
    limit: number = 3
  ): ReferenceExample[] {
    const keywords = this.extractKeywords(userPrompt);
    const scored: Array<{ example: ReferenceExample; score: number }> = [];

    for (const example of this.examples.values()) {
      let score = 0;

      // Keyword matching
      keywords.forEach(keyword => {
        if (example.name.toLowerCase().includes(keyword)) score += 3;
        if (example.description.toLowerCase().includes(keyword)) score += 2;
        if (example.metadata.tags.some(tag => tag.includes(keyword))) score += 2;
      });

      // Quality boost
      score += example.qualityMetrics.avgQualityScore / 20;
      score += example.qualityMetrics.successRate * 2;

      // Recency boost
      const daysSinceUpdate = this.getDaysSince(example.lastUpdated);
      if (daysSinceUpdate < 30) score += 2;
      else if (daysSinceUpdate < 90) score += 1;
      else score -= 1; // Penalize old examples

      // Penalize reported issues
      score -= example.qualityMetrics.reportedIssues * 0.5;

      scored.push({ example, score });
    }

    // Sort by score and return top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.example);
  }

  /**
   * Record feedback from generated design
   */
  public async recordFeedback(feedback: FeedbackData): Promise<void> {
    this.feedbackQueue.push(feedback);

    const example = this.examples.get(feedback.exampleId);
    if (!example) return;

    // Update usage count
    example.qualityMetrics.usageCount++;
    example.qualityMetrics.lastUsed = feedback.timestamp;

    // Update rolling averages
    const alpha = 0.3; // Exponential moving average factor
    example.qualityMetrics.avgQualityScore =
      alpha * feedback.qualityScore +
      (1 - alpha) * example.qualityMetrics.avgQualityScore;

    example.qualityMetrics.avgAccessibilityScore =
      alpha * feedback.accessibilityScore +
      (1 - alpha) * example.qualityMetrics.avgAccessibilityScore;

    example.qualityMetrics.avgPerformanceScore =
      alpha * feedback.performanceScore +
      (1 - alpha) * example.qualityMetrics.avgPerformanceScore;

    // Update success rate
    const success = feedback.qualityScore >= 75 ? 1 : 0;
    example.qualityMetrics.successRate =
      alpha * success +
      (1 - alpha) * example.qualityMetrics.successRate;

    // Track issues
    if (feedback.issues && feedback.issues.length > 0) {
      example.qualityMetrics.reportedIssues += feedback.issues.length;
    }

    // Persist updated metrics
    await this.saveExample(example);

    // Check if update is needed
    if (example.qualityMetrics.usageCount % this.updateThreshold === 0) {
      await this.triggerExampleUpdate(example);
    }
  }

  /**
   * Trigger automatic example improvement
   */
  private async triggerExampleUpdate(example: ReferenceExample): Promise<void> {
    console.log(`[RefLib] Triggering update for ${example.name}...`);

    // Analyze feedback patterns
    const recentFeedback = this.feedbackQueue.filter(
      f => f.exampleId === example.id
    ).slice(-10);

    const avgQuality = recentFeedback.reduce((sum, f) => sum + f.qualityScore, 0) / recentFeedback.length;

    // If quality is declining, mark for review
    if (avgQuality < 70) {
      console.warn(`[RefLib] ${example.name} quality declining (${avgQuality.toFixed(1)}/100) - marking for review`);

      // In production, this would trigger:
      // 1. Automated regeneration with improved prompt
      // 2. Human review notification
      // 3. Temporary demotion in search results

      example.metadata.tags.push('needs-review');
      await this.saveExample(example);
    }

    // If quality is consistently high, promote
    if (avgQuality >= 90 && example.qualityMetrics.successRate >= 0.9) {
      console.log(`[RefLib] ${example.name} performing excellently - promoting`);
      example.metadata.tags.push('high-quality');
      await this.saveExample(example);
    }
  }

  /**
   * Periodic maintenance: prune low-quality, update stale examples
   */
  public async performMaintenance(): Promise<void> {
    console.log('[RefLib] Starting maintenance cycle...');

    const now = Date.now();
    const updates: Promise<void>[] = [];

    for (const example of this.examples.values()) {
      const daysSinceUpdate = this.getDaysSince(example.lastUpdated);

      // Remove examples with consistently poor performance
      if (
        example.qualityMetrics.usageCount > 20 &&
        example.qualityMetrics.avgQualityScore < 60 &&
        example.qualityMetrics.successRate < 0.5
      ) {
        console.log(`[RefLib] Archiving poor performer: ${example.name}`);
        updates.push(this.archiveExample(example));
        continue;
      }

      // Update stale examples (>6 months)
      if (daysSinceUpdate > 180) {
        console.log(`[RefLib] Updating stale example: ${example.name} (${daysSinceUpdate} days old)`);
        updates.push(this.refreshExample(example));
      }
    }

    await Promise.all(updates);
    console.log('[RefLib] Maintenance complete');
  }

  /**
   * Add new example to library
   */
  public async addExample(
    example: Omit<ReferenceExample, 'id' | 'qualityMetrics' | 'version' | 'lastUpdated'>
  ): Promise<string> {
    const id = this.generateId(example.name);

    const fullExample: ReferenceExample = {
      ...example,
      id,
      qualityMetrics: {
        usageCount: 0,
        avgQualityScore: 75, // Start with neutral score
        avgAccessibilityScore: 75,
        avgPerformanceScore: 75,
        successRate: 0.75,
        lastUsed: new Date().toISOString(),
        reportedIssues: 0
      },
      version: 1,
      lastUpdated: new Date().toISOString()
    };

    this.examples.set(id, fullExample);
    await this.saveExample(fullExample);

    return id;
  }

  /**
   * Get library statistics
   */
  public getStats() {
    const examples = Array.from(this.examples.values());

    return {
      totalExamples: examples.length,
      avgQualityScore: examples.reduce((sum, e) => sum + e.qualityMetrics.avgQualityScore, 0) / examples.length,
      avgAccessibilityScore: examples.reduce((sum, e) => sum + e.qualityMetrics.avgAccessibilityScore, 0) / examples.length,
      avgPerformanceScore: examples.reduce((sum, e) => sum + e.qualityMetrics.avgPerformanceScore, 0) / examples.length,
      totalUsageCount: examples.reduce((sum, e) => sum + e.qualityMetrics.usageCount, 0),
      highQualityCount: examples.filter(e => e.qualityMetrics.avgQualityScore >= 85).length,
      needsReviewCount: examples.filter(e => e.metadata.tags.includes('needs-review')).length,
      staleCount: examples.filter(e => this.getDaysSince(e.lastUpdated) > 180).length,
      categories: this.getCategoryCounts(examples)
    };
  }

  // Helper methods

  private saveExample(example: ReferenceExample): Promise<void> {
    return new Promise((resolve, reject) => {
      const categoryPath = path.join(this.libraryPath, 'examples', example.category);
      if (!fs.existsSync(categoryPath)) {
        fs.mkdirSync(categoryPath, { recursive: true });
      }

      const filePath = path.join(categoryPath, `${example.id}.json`);

      fs.writeFile(
        filePath,
        JSON.stringify(example, null, 2),
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  private async archiveExample(example: ReferenceExample): Promise<void> {
    const archivePath = path.join(this.libraryPath, 'archive', example.category);
    if (!fs.existsSync(archivePath)) {
      fs.mkdirSync(archivePath, { recursive: true });
    }

    const sourcePath = path.join(this.libraryPath, 'examples', example.category, `${example.id}.json`);
    const targetPath = path.join(archivePath, `${example.id}.json`);

    fs.renameSync(sourcePath, targetPath);
    this.examples.delete(example.id);
  }

  private async refreshExample(example: ReferenceExample): Promise<void> {
    // In production, this would trigger regeneration
    example.version++;
    example.lastUpdated = new Date().toISOString();
    await this.saveExample(example);
  }

  private extractKeywords(prompt: string): string[] {
    const stopWords = new Set(['a', 'an', 'the', 'with', 'for', 'to', 'in', 'on', 'at', 'is', 'are']);
    return prompt
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  private getDaysSince(dateStr: string): number {
    const date = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
      '-' +
      Date.now().toString(36);
  }

  private getCategoryCounts(examples: ReferenceExample[]): Record<string, number> {
    const counts: Record<string, number> = {};
    examples.forEach(e => {
      counts[e.category] = (counts[e.category] || 0) + 1;
    });
    return counts;
  }

  private seedInitialExamples(): void {
    // Create placeholder for initial seeding
    console.log('[RefLib] Seeding initial examples...');
    // In production, this would load curated examples
  }
}
