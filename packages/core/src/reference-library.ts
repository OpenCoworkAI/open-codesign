/**
 * Reference Library System for Open CoDesign
 * Loads high-quality design examples for few-shot learning
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ReferenceExample {
  id: string;
  category: string;
  name: string;
  prompt: string;
  designDecisions: string;
  output: string;
  screenshot?: string;
  metrics: ExampleMetrics;
  tags: string[];
}

export interface ExampleMetrics {
  quality_score: number;
  accessibility_score: number;
  performance_score: number;
  wcag_level: string;
  tokens_used: number;
  generation_time_sec: number;
}

// Base path for references (configurable)
const REFERENCES_ROOT = process.env.REFERENCES_PATH || path.join(process.cwd(), 'references');

/**
 * Load examples by category with quality filtering
 */
export async function loadExamplesByCategory(
  category: string,
  minQualityScore: number = 85
): Promise<ReferenceExample[]> {
  const categoryPath = path.join(REFERENCES_ROOT, 'high-quality-designs', category);

  if (!fs.existsSync(categoryPath)) {
    console.warn(`[reference-library] Category not found: ${category}`);
    return [];
  }

  const examples: ReferenceExample[] = [];
  const dirs = fs.readdirSync(categoryPath, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const examplePath = path.join(categoryPath, dir.name);
    const metricsPath = path.join(examplePath, 'metrics.json');

    if (!fs.existsSync(metricsPath)) {
      console.warn(`[reference-library] No metrics.json for: ${dir.name}`);
      continue;
    }

    try {
      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));

      // Filter by quality
      if (metrics.quality_scores?.overall < minQualityScore) {
        continue;
      }

      const example: ReferenceExample = {
        id: `${category}/${dir.name}`,
        category,
        name: dir.name,
        prompt: readFileIfExists(path.join(examplePath, 'prompt.md')),
        designDecisions: readFileIfExists(path.join(examplePath, 'design-decisions.md')),
        output: readFileIfExists(path.join(examplePath, 'output.html')),
        screenshot: fs.existsSync(path.join(examplePath, 'screenshot.png'))
          ? path.join(examplePath, 'screenshot.png')
          : undefined,
        metrics: {
          quality_score: metrics.quality_scores?.overall || 0,
          accessibility_score: metrics.quality_scores?.accessibility || 0,
          performance_score: metrics.performance?.lighthouse_performance || 0,
          wcag_level: metrics.wcag_compliance?.level || 'unknown',
          tokens_used: metrics.generation?.tokens_total || 0,
          generation_time_sec: metrics.generation?.time_seconds || 0
        },
        tags: extractTags(dir.name)
      };

      examples.push(example);
    } catch (error) {
      console.error(`[reference-library] Error loading ${dir.name}:`, error);
    }
  }

  // Sort by quality score descending
  return examples.sort((a, b) => b.metrics.quality_score - a.metrics.quality_score);
}

/**
 * Search examples across all categories
 */
export async function searchExamples(
  query: string,
  category?: string,
  limit: number = 5
): Promise<ReferenceExample[]> {
  const allExamples = category
    ? await loadExamplesByCategory(category)
    : await loadAllExamples();

  const queryTokens = tokenize(query.toLowerCase());

  const scored = allExamples.map(example => {
    const promptTokens = tokenize(example.prompt.toLowerCase());
    const decisionTokens = tokenize(example.designDecisions.toLowerCase());

    const promptMatch = calculateOverlap(queryTokens, promptTokens);
    const decisionMatch = calculateOverlap(queryTokens, decisionTokens);
    const tagMatch = example.tags.some(tag =>
      queryTokens.some(token => tag.includes(token))
    );

    // Weighted scoring
    const score = (promptMatch * 0.5) + (decisionMatch * 0.3) + (tagMatch ? 0.2 : 0);

    return { example, score };
  });

  return scored
    .filter(s => s.score > 0.1) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.example);
}

/**
 * Load relevant examples for a user prompt (auto-categorize + search)
 */
export async function loadRelevantExamples(
  userPrompt: string,
  category?: string,
  limit: number = 3
): Promise<ReferenceExample[]> {
  // Infer category if not provided
  if (!category) {
    category = inferCategory(userPrompt);
  }

  // Try semantic search first
  let examples = await searchExamples(userPrompt, category, limit);

  // Fallback to top-rated in category if not enough results
  if (examples.length < limit) {
    const categoryExamples = await loadExamplesByCategory(category, 85);
    const needed = limit - examples.length;
    const additional = categoryExamples
      .filter(ex => !examples.find(e => e.id === ex.id))
      .slice(0, needed);
    examples = [...examples, ...additional];
  }

  return examples.slice(0, limit);
}

/**
 * Format examples for prompt injection
 */
export function formatExamplesForPrompt(
  examples: ReferenceExample[],
  includeCode: boolean = false
): string {
  if (examples.length === 0) {
    return '';
  }

  let output = '## High-Quality Reference Examples\n\n';
  output += 'Study these examples to match their quality level:\n\n';

  for (const ex of examples) {
    output += `### ${ex.name} (Quality: ${ex.metrics.quality_score}/100)\n\n`;

    // Add prompt
    const promptText = extractPromptText(ex.prompt);
    if (promptText) {
      output += '**Original Prompt:**\n';
      output += promptText + '\n\n';
    }

    // Add key decisions (shortened)
    const keyDecisions = extractKeyDecisions(ex.designDecisions);
    if (keyDecisions) {
      output += '**Key Design Decisions:**\n';
      output += keyDecisions + '\n\n';
    }

    // Optionally include code snippet
    if (includeCode && ex.output) {
      output += '**Output Preview:**\n```html\n';
      output += ex.output.substring(0, 500);
      output += ex.output.length > 500 ? '\n...\n' : '\n';
      output += '```\n\n';
    }

    output += '---\n\n';
  }

  return output;
}

/**
 * Infer category from user prompt
 */
export function inferCategory(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (lower.match(/landing|homepage|marketing/)) return 'landing-pages';
  if (lower.match(/dashboard|analytics|admin|metrics|kpi/)) return 'dashboards';
  if (lower.match(/mobile|app|ios|android|phone/)) return 'mobile-apps';
  if (lower.match(/presentation|slide|deck|pitch/)) return 'presentations';
  if (lower.match(/product|cart|checkout|store|shop|ecommerce/)) return 'ecommerce';
  if (lower.match(/component|button|form|card|modal/)) return 'components';

  return 'landing-pages'; // default fallback
}

// Helper functions

function readFileIfExists(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  } catch {
    return '';
  }
}

function tokenize(text: string): string[] {
  return text.match(/\b\w+\b/g) || [];
}

function calculateOverlap(tokens1: string[], tokens2: string[]): number {
  if (tokens1.length === 0) return 0;
  const set2 = new Set(tokens2);
  const matches = tokens1.filter(t => set2.has(t)).length;
  return matches / tokens1.length;
}

function extractTags(filename: string): string[] {
  return filename.split('-').filter(tag => tag.length > 2);
}

function extractPromptText(promptMd: string): string {
  const lines = promptMd.split('\n');
  const promptSection = lines.findIndex(l => l.includes('## Original Prompt'));
  if (promptSection === -1) return promptMd.substring(0, 200);

  const textLines = [];
  for (let i = promptSection + 1; i < lines.length && i < promptSection + 6; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      textLines.push(line);
    }
  }
  return textLines.join(' ').substring(0, 200);
}

function extractKeyDecisions(decisionsMd: string): string {
  const lines = decisionsMd.split('\n');
  const bullets = lines
    .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
    .slice(0, 5)
    .map(line => line.trim());

  return bullets.join('\n');
}

async function loadAllExamples(): Promise<ReferenceExample[]> {
  const categories = ['landing-pages', 'dashboards', 'mobile-apps', 'presentations', 'ecommerce', 'components'];
  const all: ReferenceExample[] = [];

  for (const cat of categories) {
    try {
      const examples = await loadExamplesByCategory(cat);
      all.push(...examples);
    } catch (error) {
      console.warn(`[reference-library] Failed to load category ${cat}:`, error);
    }
  }

  return all;
}

/**
 * Get statistics about reference library
 */
export async function getReferenceStats(): Promise<{
  total: number;
  by_category: Record<string, number>;
  avg_quality: number;
  min_quality: number;
  max_quality: number;
}> {
  const all = await loadAllExamples();

  const by_category: Record<string, number> = {};
  for (const ex of all) {
    by_category[ex.category] = (by_category[ex.category] || 0) + 1;
  }

  const scores = all.map(ex => ex.metrics.quality_score);

  return {
    total: all.length,
    by_category,
    avg_quality: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    min_quality: scores.length > 0 ? Math.min(...scores) : 0,
    max_quality: scores.length > 0 ? Math.max(...scores) : 0
  };
}
