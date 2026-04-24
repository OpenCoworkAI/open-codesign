/**
 * Keyword routing for progressive-disclosure prompt composition.
 *
 * Maps cues in the user's prompt (dashboard / mobile / marketing / logo)
 * onto which top-level sections and craft-directives subsections to include
 * in Layer 2 of the composed system prompt.
 */
import { CHART_RENDERING, IOS_STARTER_TEMPLATE, MARKETING_FONT_HINT } from './sections/loader.js';

const KEYWORDS_DASHBOARD =
  /\b(dashboard|chart|graph|plot|visualization|analytics|metric|kpi)s?\b|数据|看板|图表/i;
const KEYWORDS_MOBILE = /\b(mobile|iOS|iPhone|iPad|app screen|app design)\b|手机|移动端/i;
const KEYWORDS_MARKETING =
  /\b(case study|landing|marketing|hero|pricing)\b|案例|落地页|登录页|首页/i;
const KEYWORDS_LOGO = /\b(logo|brand|monogram)s?\b|品牌/i;

export interface KeywordMatchPlan {
  topLevel: string[];
  craftSubsectionNames: string[];
}

export function planKeywordMatches(userPrompt: string): KeywordMatchPlan {
  const topLevel: string[] = [];
  const craftSubsectionNames: string[] = [];

  if (KEYWORDS_DASHBOARD.test(userPrompt)) {
    topLevel.push(CHART_RENDERING);
    craftSubsectionNames.push('Dashboard ambient signals');
  }
  if (KEYWORDS_MOBILE.test(userPrompt)) {
    topLevel.push(IOS_STARTER_TEMPLATE);
  }
  if (KEYWORDS_MARKETING.test(userPrompt)) {
    topLevel.push(MARKETING_FONT_HINT);
    craftSubsectionNames.push(
      'Single-page structure ladder',
      'Big numbers get dedicated visual blocks',
      'Customer quotes deserve distinguished treatment',
    );
  }
  if (KEYWORDS_LOGO.test(userPrompt)) {
    craftSubsectionNames.push('Logos and brand marks');
  }

  return { topLevel, craftSubsectionNames };
}
