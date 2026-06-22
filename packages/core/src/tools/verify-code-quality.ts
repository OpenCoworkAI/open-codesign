/**
 * Code Quality Verification Tool for Open CoDesign
 * Automated checking of HTML, CSS, JS, and Performance
 */

export interface CodeQualityCheck {
  category: 'html' | 'css' | 'js' | 'performance';
  rule: string;
  severity: 'error' | 'warning' | 'info';
  passed: boolean;
  message: string;
  line?: number;
  suggestion?: string;
}

export interface CategoryScore {
  score: number;
  passed: number;
  failed: number;
  warnings: number;
}

export interface CodeQualityReport {
  overall_score: number; // 0-100
  categories: {
    html: CategoryScore;
    css: CategoryScore;
    js: CategoryScore;
    performance: CategoryScore;
  };
  checks: CodeQualityCheck[];
  recommendations: string[];
}

/**
 * Main verification function
 */
export async function verifyCodeQuality(
  html: string,
  css?: string,
  js?: string
): Promise<CodeQualityReport> {
  const checks: CodeQualityCheck[] = [];

  // Extract CSS and JS from HTML if not provided separately
  if (!css) {
    const cssMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    css = cssMatch ? cssMatch[1] : '';
  }

  if (!js) {
    const jsMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    js = jsMatch ? jsMatch[1] : '';
  }

  // Run HTML checks
  checks.push(...checkHTML(html));

  // Run CSS checks
  if (css) {
    checks.push(...checkCSS(css));
  }

  // Run JS checks
  if (js) {
    checks.push(...checkJS(js));
  }

  // Run performance checks
  checks.push(...checkPerformance(html, css, js));

  return aggregateReport(checks);
}

/**
 * HTML Quality Checks
 */
function checkHTML(html: string): CodeQualityCheck[] {
  const checks: CodeQualityCheck[] = [];

  // Check 1: Valid DOCTYPE
  if (!/^<!DOCTYPE html>/i.test(html.trim())) {
    checks.push({
      category: 'html',
      rule: 'valid_doctype',
      severity: 'error',
      passed: false,
      message: 'Missing or invalid DOCTYPE declaration',
      suggestion: 'Add <!DOCTYPE html> at the start of the file'
    });
  } else {
    checks.push({
      category: 'html',
      rule: 'valid_doctype',
      severity: 'error',
      passed: true,
      message: 'Valid DOCTYPE present'
    });
  }

  // Check 2: Charset declaration
  if (!/<meta[^>]*charset/i.test(html)) {
    checks.push({
      category: 'html',
      rule: 'charset_declaration',
      severity: 'error',
      passed: false,
      message: 'Missing charset declaration',
      suggestion: 'Add <meta charset="utf-8"> in <head>'
    });
  }

  // Check 3: Viewport meta tag
  if (!/<meta[^>]*name=["']viewport["']/i.test(html)) {
    checks.push({
      category: 'html',
      rule: 'meta_viewport',
      severity: 'warning',
      passed: false,
      message: 'Missing viewport meta tag for responsive design',
      suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">'
    });
  }

  // Check 4: Inline styles abuse
  const inlineStyleCount = (html.match(/style="/g) || []).length;
  if (inlineStyleCount > 5) {
    checks.push({
      category: 'html',
      rule: 'no_inline_styles_abuse',
      severity: 'warning',
      passed: false,
      message: `Too many inline styles (${inlineStyleCount} found) - use CSS classes instead`,
      suggestion: 'Extract inline styles to CSS classes'
    });
  }

  // Check 5: Proper nesting
  const badNesting = [
    { pattern: /<p[^>]*>[\s\S]*<div/i, message: 'Invalid: <div> inside <p>' },
    { pattern: /<span[^>]*>[\s\S]*<div/i, message: 'Invalid: <div> inside <span>' },
    { pattern: /<a[^>]*>[\s\S]*<a/i, message: 'Invalid: <a> inside <a>' }
  ];

  for (const { pattern, message } of badNesting) {
    if (pattern.test(html)) {
      checks.push({
        category: 'html',
        rule: 'proper_nesting',
        severity: 'error',
        passed: false,
        message: `HTML nesting error: ${message}`,
        suggestion: 'Fix element nesting according to HTML spec'
      });
      break;
    }
  }

  // Check 6: Semantic HTML usage
  const semanticTags = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer'];
  const hasSemantic = semanticTags.some(tag => new RegExp(`<${tag}[\\s>]`, 'i').test(html));

  checks.push({
    category: 'html',
    rule: 'semantic_html',
    severity: 'info',
    passed: hasSemantic,
    message: hasSemantic
      ? 'Uses semantic HTML5 elements'
      : 'Consider using semantic HTML5 elements',
    suggestion: hasSemantic ? undefined : 'Use <header>, <main>, <nav>, etc. instead of generic <div>'
  });

  // Check 7: No deprecated tags
  const deprecatedTags = ['center', 'font', 'marquee', 'blink'];
  for (const tag of deprecatedTags) {
    if (new RegExp(`<${tag}[\\s>]`, 'i').test(html)) {
      checks.push({
        category: 'html',
        rule: 'no_deprecated_tags',
        severity: 'warning',
        passed: false,
        message: `Deprecated tag <${tag}> found`,
        suggestion: `Replace <${tag}> with modern HTML and CSS`
      });
    }
  }

  return checks;
}

/**
 * CSS Quality Checks
 */
function checkCSS(css: string): CodeQualityCheck[] {
  const checks: CodeQualityCheck[] = [];

  // Check 1: !important abuse
  const importantCount = (css.match(/!important/g) || []).length;
  if (importantCount > 3) {
    checks.push({
      category: 'css',
      rule: 'no_important_abuse',
      severity: 'warning',
      passed: false,
      message: `Excessive use of !important (${importantCount} found)`,
      suggestion: 'Refactor CSS specificity instead of using !important'
    });
  }

  // Check 2: Consistent units
  const pxCount = (css.match(/:\s*\d+px/g) || []).length;
  const remCount = (css.match(/:\s*\d+\.?\d*rem/g) || []).length;

  if (pxCount > 20 && remCount > 20) {
    checks.push({
      category: 'css',
      rule: 'consistent_units',
      severity: 'info',
      passed: false,
      message: 'Mixing many px and rem units - consider consistency',
      suggestion: 'Use rem for typography, px for precise measurements'
    });
  }

  // Check 3: Mobile-first media queries
  const minWidthCount = (css.match(/@media[^{]*min-width/g) || []).length;
  const maxWidthCount = (css.match(/@media[^{]*max-width/g) || []).length;

  if (maxWidthCount > minWidthCount && maxWidthCount > 0) {
    checks.push({
      category: 'css',
      rule: 'mobile_first_queries',
      severity: 'info',
      passed: false,
      message: 'Using max-width media queries - consider mobile-first approach',
      suggestion: 'Use min-width media queries for mobile-first design'
    });
  }

  // Check 4: Design tokens / CSS custom properties
  const hasCustomProps = /--[\w-]+:/.test(css);
  const hardcodedColors = (css.match(/#[0-9a-f]{3,6}\b|rgba?\(|hsla?\(/gi) || []).length;

  if (!hasCustomProps && hardcodedColors > 10) {
    checks.push({
      category: 'css',
      rule: 'design_token_usage',
      severity: 'info',
      passed: false,
      message: 'No CSS custom properties used with many hardcoded colors',
      suggestion: 'Use CSS custom properties (--color-primary) for design tokens'
    });
  } else if (hasCustomProps) {
    checks.push({
      category: 'css',
      rule: 'design_token_usage',
      severity: 'info',
      passed: true,
      message: 'Uses CSS custom properties for theming'
    });
  }

  // Check 5: Vendor prefixes (shouldn't be needed with autoprefixer)
  const vendorPrefixes = (css.match(/-(webkit|moz|ms|o)-/g) || []).length;
  if (vendorPrefixes > 0) {
    checks.push({
      category: 'css',
      rule: 'no_vendor_prefixes_needed',
      severity: 'info',
      passed: false,
      message: 'Manual vendor prefixes found',
      suggestion: 'Use autoprefixer instead of manual vendor prefixes'
    });
  }

  // Check 6: CSS organization
  const hasComments = /\/\*[\s\S]*?\*\//.test(css);
  const lineCount = css.split('\n').length;

  if (lineCount > 100 && !hasComments) {
    checks.push({
      category: 'css',
      rule: 'organized_structure',
      severity: 'info',
      passed: false,
      message: 'Large CSS file without section comments',
      suggestion: 'Add comments to organize CSS sections'
    });
  }

  return checks;
}

/**
 * JavaScript Quality Checks
 */
function checkJS(js: string): CodeQualityCheck[] {
  const checks: CodeQualityCheck[] = [];

  // Check 1: Console statements
  if (/console\.(log|warn|error|debug)/i.test(js)) {
    checks.push({
      category: 'js',
      rule: 'no_console_logs',
      severity: 'warning',
      passed: false,
      message: 'Console statements found',
      suggestion: 'Remove console statements before production'
    });
  }

  // Check 2: eval usage
  if (/\beval\s*\(/.test(js)) {
    checks.push({
      category: 'js',
      rule: 'no_eval',
      severity: 'error',
      passed: false,
      message: 'eval() usage detected - security risk',
      suggestion: 'Avoid eval() - use safer alternatives'
    });
  }

  // Check 3: Error handling for async
  const hasAsync = /async\s+function/.test(js);
  const hasTryCatch = /try\s*{/.test(js) && /catch\s*\(/.test(js);

  if (hasAsync && !hasTryCatch) {
    checks.push({
      category: 'js',
      rule: 'error_handling',
      severity: 'warning',
      passed: false,
      message: 'Async functions without try/catch error handling',
      suggestion: 'Add try/catch blocks for async error handling'
    });
  }

  // Check 4: Modern syntax
  const hasVar = /\bvar\s+/.test(js);
  if (hasVar) {
    checks.push({
      category: 'js',
      rule: 'modern_syntax',
      severity: 'info',
      passed: false,
      message: 'Using var instead of let/const',
      suggestion: 'Use let or const instead of var'
    });
  }

  // Check 5: Event listeners vs inline
  const hasInlineEvents = /on(click|load|change|submit|keyup|keydown)=/i.test(js);
  if (hasInlineEvents) {
    checks.push({
      category: 'js',
      rule: 'proper_event_listeners',
      severity: 'info',
      passed: false,
      message: 'Inline event handlers found',
      suggestion: 'Use addEventListener instead of inline event handlers'
    });
  }

  return checks;
}

/**
 * Performance Checks
 */
function checkPerformance(html: string, css?: string, js?: string): CodeQualityCheck[] {
  const checks: CodeQualityCheck[] = [];

  // Check 1: Bundle size
  const totalSize = Buffer.byteLength(html + (css || '') + (js || ''), 'utf8');
  const sizeKb = totalSize / 1024;

  if (sizeKb > 500) {
    checks.push({
      category: 'performance',
      rule: 'bundle_size_check',
      severity: 'warning',
      passed: false,
      message: `Large file size (${Math.round(sizeKb)}KB)`,
      suggestion: 'Consider code splitting or minification'
    });
  }

  // Check 2: Image optimization
  const hasImages = /<img/.test(html);
  const hasLazyLoading = /loading=["']lazy["']/.test(html);

  if (hasImages && !hasLazyLoading) {
    checks.push({
      category: 'performance',
      rule: 'image_optimization',
      severity: 'info',
      passed: false,
      message: 'Images without lazy loading',
      suggestion: 'Add loading="lazy" to below-the-fold images'
    });
  }

  // Check 3: Blocking resources
  const hasBlockingScript = /<script(?![^>]*defer)(?![^>]*async)[^>]*src/.test(html);
  if (hasBlockingScript) {
    checks.push({
      category: 'performance',
      rule: 'blocking_resources',
      severity: 'warning',
      passed: false,
      message: 'Blocking script tags found',
      suggestion: 'Add defer or async attribute to script tags'
    });
  }

  // Check 4: CSS minification hint
  if (css && css.length > 1000 && /\n\s{4,}/.test(css)) {
    checks.push({
      category: 'performance',
      rule: 'css_minification',
      severity: 'info',
      passed: false,
      message: 'CSS not minified',
      suggestion: 'Minify CSS for production deployment'
    });
  }

  return checks;
}

/**
 * Aggregate report with scoring
 */
function aggregateReport(checks: CodeQualityCheck[]): CodeQualityReport {
  const categories = {
    html: calculateCategoryScore(checks.filter(c => c.category === 'html')),
    css: calculateCategoryScore(checks.filter(c => c.category === 'css')),
    js: calculateCategoryScore(checks.filter(c => c.category === 'js')),
    performance: calculateCategoryScore(checks.filter(c => c.category === 'performance'))
  };

  const overall_score = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score, 0) / 4
  );

  const recommendations = generateRecommendations(checks);

  return {
    overall_score,
    categories,
    checks,
    recommendations
  };
}

function calculateCategoryScore(checks: CodeQualityCheck[]): CategoryScore {
  if (checks.length === 0) {
    return { score: 100, passed: 0, failed: 0, warnings: 0 };
  }

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed && c.severity === 'error').length;
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;

  // Scoring: errors heavily penalized, warnings moderately, info lightly
  let score = 100;
  score -= failed * 20; // -20 per error
  score -= warnings * 10; // -10 per warning
  score -= (checks.length - passed - failed - warnings) * 5; // -5 per info

  return {
    score: Math.max(0, score),
    passed,
    failed,
    warnings
  };
}

function generateRecommendations(checks: CodeQualityCheck[]): string[] {
  const failed = checks.filter(c => !c.passed && c.severity === 'error');
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning');

  const recommendations: string[] = [];

  if (failed.length > 0) {
    recommendations.push(`Fix ${failed.length} critical error(s) immediately`);
  }

  if (warnings.length > 0) {
    recommendations.push(`Address ${warnings.length} warning(s) for production quality`);
  }

  // Top 3 specific suggestions
  const topIssues = [...failed, ...warnings]
    .filter(c => c.suggestion)
    .slice(0, 3)
    .map(c => c.suggestion!);

  recommendations.push(...topIssues);

  return recommendations;
}
