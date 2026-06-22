/**
 * Accessibility Verification Tool for Open CoDesign
 * Checks generated HTML for WCAG 2.1 Level A/AA compliance
 */

export interface AccessibilityCheck {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  passed: boolean;
  message: string;
  element?: string;
  line?: number;
}

export interface AccessibilityReport {
  overall_score: number;
  total_checks: number;
  passed: number;
  failed: number;
  warnings: number;
  checks: AccessibilityCheck[];
  wcag_level: 'A' | 'AA' | 'AAA' | 'failed';
}

export interface AccessibilityOptions {
  ignoreWarnings?: boolean;
  customRules?: string[];
}

/**
 * Main verification function
 */
export async function verifyAccessibility(
  htmlContent: string,
  options: AccessibilityOptions = {}
): Promise<AccessibilityReport> {
  const checks: AccessibilityCheck[] = [];

  // Parse HTML (simple regex-based for now, can upgrade to full parser)

  // Run WCAG Level A checks
  checks.push(...checkImages(htmlContent));
  checks.push(...checkFormLabels(htmlContent));
  checks.push(...checkHeadingHierarchy(htmlContent));
  checks.push(...checkSkipLinks(htmlContent));
  checks.push(...checkAriaRequired(htmlContent));

  // Run WCAG Level AA checks
  checks.push(...checkColorContrast(htmlContent));
  checks.push(...checkFocusIndicators(htmlContent));
  checks.push(...checkTouchTargets(htmlContent));

  // Run best practices
  checks.push(...checkSemanticHTML(htmlContent));
  checks.push(...checkLandmarks(htmlContent));

  return aggregateReport(checks, options);
}

/**
 * WCAG Level A: Check all images have alt text
 */
function checkImages(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];
  const imgRegex = /<img[^>]*>/gi;
  const matches = html.match(imgRegex) || [];

  for (const img of matches) {
    const hasAlt = /alt=["'][^"']*["']/.test(img) || /alt=""/.test(img);

    if (!hasAlt) {
      checks.push({
        id: 'alt_text_on_images',
        severity: 'critical',
        passed: false,
        message: 'Image missing alt attribute',
        element: img.substring(0, 100)
      });
    } else {
      const altValue = img.match(/alt=["']([^"']*)["']/)?.[1];
      if (altValue && altValue.length > 0) {
        checks.push({
          id: 'alt_text_on_images',
          severity: 'critical',
          passed: true,
          message: 'Image has descriptive alt text',
          element: img.substring(0, 100)
        });
      }
    }
  }

  return checks;
}

/**
 * WCAG Level A: Check form inputs have labels
 */
function checkFormLabels(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];
  const inputRegex = /<input[^>]*type=["'](?!hidden|submit|button)[^"']*["'][^>]*>/gi;
  const matches = html.match(inputRegex) || [];

  for (const input of matches) {
    const hasId = /id=["']([^"']+)["']/.test(input);
    const idValue = input.match(/id=["']([^"']+)["']/)?.[1];

    if (!hasId) {
      checks.push({
        id: 'form_labels',
        severity: 'critical',
        passed: false,
        message: 'Form input missing id for label association',
        element: input.substring(0, 100)
      });
      continue;
    }

    // Check if there's a corresponding label
    const labelRegex = new RegExp(`<label[^>]*for=["']${idValue}["'][^>]*>`, 'i');
    const hasLabel = labelRegex.test(html);

    checks.push({
      id: 'form_labels',
      severity: 'critical',
      passed: hasLabel,
      message: hasLabel
        ? 'Form input has associated label'
        : 'Form input missing associated label',
      element: input.substring(0, 100)
    });
  }

  return checks;
}

/**
 * WCAG Level A: Check heading hierarchy
 */
function checkHeadingHierarchy(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];
  const headingRegex = /<h([1-6])[^>]*>/gi;
  const headings: number[] = [];

  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push(parseInt(match[1]));
  }

  if (headings.length === 0) {
    checks.push({
      id: 'heading_hierarchy',
      severity: 'warning',
      passed: false,
      message: 'No headings found - consider adding semantic structure'
    });
    return checks;
  }

  // Check if starts with h1
  if (headings[0] !== 1) {
    checks.push({
      id: 'heading_hierarchy',
      severity: 'warning',
      passed: false,
      message: 'Page should start with <h1>, not <h' + headings[0] + '>'
    });
  }

  // Check for skipped levels
  for (let i = 1; i < headings.length; i++) {
    const current = headings[i];
    const previous = headings[i - 1];

    if (current > previous + 1) {
      checks.push({
        id: 'heading_hierarchy',
        severity: 'warning',
        passed: false,
        message: `Heading hierarchy skipped from <h${previous}> to <h${current}>`
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      id: 'heading_hierarchy',
      severity: 'critical',
      passed: true,
      message: 'Heading hierarchy is logical'
    });
  }

  return checks;
}

/**
 * WCAG Level A: Check for skip navigation link
 */
function checkSkipLinks(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];
  const hasSkipLink = /<a[^>]*href=["']#(main|content|skip)[^"']*["'][^>]*>skip/i.test(html);

  checks.push({
    id: 'skip_links',
    severity: 'info',
    passed: hasSkipLink,
    message: hasSkipLink
      ? 'Skip navigation link present'
      : 'Consider adding skip navigation link for keyboard users'
  });

  return checks;
}

/**
 * WCAG Level A: Check required ARIA attributes
 */
function checkAriaRequired(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];

  // Check buttons have accessible names
  const buttonRegex = /<button[^>]*>/gi;
  const buttons = html.match(buttonRegex) || [];

  for (const button of buttons) {
    const hasText = /<button[^>]*>([^<]+)<\/button>/.test(
      html.substring(html.indexOf(button))
    );
    const hasAriaLabel = /aria-label=["'][^"']+["']/.test(button);

    if (!hasText && !hasAriaLabel) {
      checks.push({
        id: 'aria_required',
        severity: 'critical',
        passed: false,
        message: 'Button missing accessible name (text content or aria-label)',
        element: button.substring(0, 100)
      });
    }
  }

  return checks;
}

/**
 * WCAG Level AA: Check color contrast (basic CSS color extraction)
 */
function checkColorContrast(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];

  // This is a simplified check - real implementation would parse CSS
  // and calculate actual contrast ratios
  const lowContrastPatterns = [
    /color:\s*#[cdef][0-9a-f]{5}/gi, // Light text colors
    /color:\s*rgba?\([^)]*0\.[0-5]\)/gi, // Low opacity text
  ];

  for (const pattern of lowContrastPatterns) {
    if (pattern.test(html)) {
      checks.push({
        id: 'color_contrast',
        severity: 'warning',
        passed: false,
        message: 'Potential low contrast text detected - verify WCAG AA (4.5:1) compliance'
      });
      break;
    }
  }

  if (checks.length === 0) {
    checks.push({
      id: 'color_contrast',
      severity: 'warning',
      passed: true,
      message: 'No obvious contrast issues detected (manual verification recommended)'
    });
  }

  return checks;
}

/**
 * WCAG Level AA: Check focus indicators
 */
function checkFocusIndicators(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];

  // Check if :focus styles are removed
  const removesFocus = /(:focus|:focus-visible)\s*{\s*outline:\s*(none|0)/i.test(html);

  if (removesFocus) {
    checks.push({
      id: 'focus_indicators',
      severity: 'critical',
      passed: false,
      message: 'Focus outline removed - ensure custom focus indicator is visible'
    });
  } else {
    checks.push({
      id: 'focus_indicators',
      severity: 'critical',
      passed: true,
      message: 'Focus indicators preserved (default or custom)'
    });
  }

  return checks;
}

/**
 * WCAG Level AA: Check touch target sizes (mobile)
 */
function checkTouchTargets(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];

  // Check for small button/link sizes
  const hasSmallTargets = /height:\s*[1-3][0-9]px|width:\s*[1-3][0-9]px/i.test(html);

  if (hasSmallTargets) {
    checks.push({
      id: 'touch_target_size',
      severity: 'warning',
      passed: false,
      message: 'Small touch targets detected - ensure minimum 44×44px on mobile'
    });
  }

  return checks;
}

/**
 * Best Practice: Check semantic HTML usage
 */
function checkSemanticHTML(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];
  const semanticTags = ['header', 'nav', 'main', 'article', 'section', 'aside', 'footer'];

  const hasSemantic = semanticTags.some(tag =>
    new RegExp(`<${tag}[\\s>]`, 'i').test(html)
  );

  checks.push({
    id: 'semantic_html',
    severity: 'info',
    passed: hasSemantic,
    message: hasSemantic
      ? 'Uses semantic HTML5 elements'
      : 'Consider using semantic HTML5 elements (header, nav, main, etc.)'
  });

  return checks;
}

/**
 * Best Practice: Check landmark regions
 */
function checkLandmarks(html: string): AccessibilityCheck[] {
  const checks: AccessibilityCheck[] = [];

  const hasMain = /<main[^>]*>/i.test(html) || /role=["']main["']/i.test(html);
  const hasNav = /<nav[^>]*>/i.test(html) || /role=["']navigation["']/i.test(html);

  if (!hasMain) {
    checks.push({
      id: 'landmarks',
      severity: 'warning',
      passed: false,
      message: 'Missing <main> landmark - helps screen reader users navigate'
    });
  }

  if (hasNav && hasMain) {
    checks.push({
      id: 'landmarks',
      severity: 'info',
      passed: true,
      message: 'Document has landmark regions'
    });
  }

  return checks;
}

/**
 * Aggregate all checks into final report
 */
function aggregateReport(
  checks: AccessibilityCheck[],
  options: AccessibilityOptions
): AccessibilityReport {
  const total = checks.length;
  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const warnings = checks.filter(c => !c.passed && c.severity === 'warning').length;

  // Calculate score (critical failures heavily weighted)
  const criticalPassed = checks.filter(c => c.severity === 'critical' && c.passed).length;
  const criticalTotal = checks.filter(c => c.severity === 'critical').length;
  const criticalScore = criticalTotal > 0 ? (criticalPassed / criticalTotal) * 100 : 100;

  const warningScore = warnings === 0 ? 100 : Math.max(0, 100 - (warnings * 5));

  const overall_score = Math.round((criticalScore * 0.7) + (warningScore * 0.3));

  // Determine WCAG level
  let wcag_level: 'A' | 'AA' | 'AAA' | 'failed';
  if (failed > 0) {
    wcag_level = 'failed';
  } else if (warnings === 0) {
    wcag_level = 'AA';
  } else if (warnings <= 2) {
    wcag_level = 'A';
  } else {
    wcag_level = 'failed';
  }

  return {
    overall_score,
    total_checks: total,
    passed,
    failed,
    warnings,
    checks: options.ignoreWarnings
      ? checks.filter(c => c.severity === 'critical')
      : checks,
    wcag_level
  };
}
