---
schemaVersion: 1
name: cjk-typography
description: >
  Sets typography for pages mixing Chinese, Japanese, or Korean with Latin
  text. Covers line-height, line-break rules, font stacks per locale,
  letter-spacing pitfalls, mixed-script spacing, body sizes, and vertical
  writing for editorial Japanese. Use when designing or coding any page
  whose audience reads zh / ja / ko.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## When to use

Trigger this skill for any UI or document with:

- Simplified or Traditional Chinese (`zh-CN`, `zh-TW`, `zh-HK`).
- Japanese (`ja`).
- Korean (`ko`).
- Mixed runs of CJK + Latin (product names, code identifiers, numbers).
- Editorial/long-form reading surfaces in CJK.

## Rules

1. **Line-height 1.7–1.8 for CJK body.** Latin defaults like 1.4–1.5 are too tight for the higher visual mass of CJK glyphs. Use 1.75 as a safe default for body, 1.5 for headings.
2. **Line-break behavior per locale.**
   - Simplified Chinese: `word-break: normal; line-break: auto`. Don't enable `break-all` for body text — it shreds compounds.
   - Japanese: `line-break: strict` so the renderer doesn't break before grammatical particles (助詞 like を, は, が).
   - Korean: `word-break: keep-all` so word-spaced Hangul wraps at spaces, not mid-word.
3. **Font stacks per locale.** Always lead with the platform-native CJK family, then a Noto fallback, then a generic.
   - `zh-CN`: `"PingFang SC", "Noto Sans SC", "Source Han Sans CN", system-ui, sans-serif`
   - `zh-TW`/`zh-HK`: `"PingFang TC", "Noto Sans TC", "Source Han Sans TW", system-ui, sans-serif`
   - `ja`: `"Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif`
   - `ko`: `"Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif`
4. **Never apply `letter-spacing` to CJK runs.** CJK characters carry their own ideographic spacing; tracking them disrupts that and creates uneven gaps. If you need rhythm tweaks, use `font-feature-settings: "palt"` (proportional alternates) on Japanese instead.
5. **Mixed CJK + Latin spacing.** When CJK characters butt against Latin words or numbers ("用 Claude 3.7 模型"), insert a thin space (`U+2009`) between runs, OR use `text-autospace: ideograph-alpha ideograph-numeric` (Chrome 121+) where supported. Never let `中文Word` render with no space.
6. **Body size 16–18 px desktop, ≥ 14 px mobile.** Sizes below 14 px destroy legibility for complex glyphs (e.g. 鬱, 鑫, 灣). Don't shrink CJK for "elegance".
7. **Vertical writing for editorial Japanese.** Use `writing-mode: vertical-rl` paired with `text-orientation: mixed` so Latin numerals stay upright inside the vertical column.

## Do / Don't

**Do**
- Set the `lang` attribute on the document and on locale-specific runs (`<span lang="ja">`).
- Use `font-feature-settings: "palt"` for Japanese display type to tighten kana proportionally.
- Test with the longest realistic strings: 鬱蒼, 麤齉, 龜鑑.
- Pair CJK fonts with matching Latin companions (PingFang already includes a Latin set; Noto Sans pairs with Noto Sans).

**Don't**
- Don't use `letter-spacing: 0.05em` "for breathing room" on CJK — it ruins the grid.
- Don't fall back to `serif` / `sans-serif` directly without naming a CJK family — the browser will pick something ugly.
- Don't set body smaller than 14 px on mobile.
- Don't use `word-break: break-all` outside of forced-narrow contexts (table cells, tag chips).
- Don't underline CJK text for emphasis — strokes collide with the underline. Use weight or a side dot mark instead.

## Code patterns

Locale-aware font stack:

```css
:root {
  --font-sans-en: "Inter", system-ui, sans-serif;
  --font-sans-zh: "PingFang SC", "Noto Sans SC", "Source Han Sans CN", system-ui, sans-serif;
  --font-sans-ja: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif;
  --font-sans-ko: "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif;
}

html { font-family: var(--font-sans-en); }
html[lang^="zh-CN"] { font-family: var(--font-sans-zh); }
html[lang^="zh-TW"], html[lang^="zh-HK"] {
  font-family: "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
}
html[lang^="ja"] { font-family: var(--font-sans-ja); }
html[lang^="ko"] { font-family: var(--font-sans-ko); }
```

CJK body defaults:

```css
.prose-cjk {
  font-size: 17px;
  line-height: 1.75;
  letter-spacing: 0;          /* never tracked */
  word-break: normal;
  text-autospace: ideograph-alpha ideograph-numeric;
}

:lang(ja) .prose-cjk { line-break: strict; }
:lang(ko) .prose-cjk { word-break: keep-all; }
```

Mixed-script with thin space fallback:

```html
<p>用<span class="thin"> </span>Claude<span class="thin"> </span>3.7<span class="thin"> </span>模型生成原型。</p>
<style>
  .thin { font-size: 0; } /* thin space supplied via U+2009 in markup */
</style>
```

Vertical Japanese:

```css
.tategaki {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-family: var(--font-sans-ja);
  line-height: 1.8;
}
```
