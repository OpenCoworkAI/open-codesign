import type { Monaco } from '@monaco-editor/react';
import type { LanguageRegistration } from 'shiki';

// VS Code's HTML grammar explicitly excludes type="text/babel" from JS
// embedding. This injection grammar restores it. R: = high priority so our
// pattern runs before HTML's own <script> rules in the same scope.
//
// Capture groups in begin (no captures inside the lookahead):
//   1: <   2: script   3: >
const babelScriptInjection: LanguageRegistration = {
  name: 'html-babel-injection',
  scopeName: 'text.html.babel-injection',
  injectionSelector: 'R:text.html.basic',
  patterns: [{ include: '#script-babel' }],
  repository: {
    'script-babel': {
      name: 'meta.embedded.block.babel',
      begin: String.raw`(<)(script)(?=[^>]*\btype=["']text/babel["'])[^>]*(>)`,
      beginCaptures: {
        '1': { name: 'punctuation.definition.tag.begin.html' },
        '2': { name: 'entity.name.tag.script.html' },
        '3': { name: 'punctuation.definition.tag.end.html' },
      },
      contentName: 'source.js',
      end: String.raw`(<\/)(script)([^>]*)(>)`,
      endCaptures: {
        '1': { name: 'punctuation.definition.tag.begin.html' },
        '2': { name: 'entity.name.tag.script.html' },
        '4': { name: 'punctuation.definition.tag.end.html' },
      },
      patterns: [{ include: 'source.js' }],
    },
  },
};

let promise: Promise<void> | null = null;

export function setupTextmateGrammars(monaco: Monaco): Promise<void> {
  if (promise) return promise;
  promise = (async () => {
    const [{ createHighlighter, bundledThemes, bundledLanguages }, { shikiToMonaco }] =
      await Promise.all([import('shiki'), import('@shikijs/monaco')]);

    // light-plus / dark-plus = VS Code's Light+/Dark+ — closest bundled
    // equivalents to Monaco's built-in vs/vs-dark.
    // Injection grammar loads before html so vscode-textmate sees it when
    // compiling text.html.basic.
    const highlighter = await createHighlighter({
      themes: [bundledThemes['light-plus'](), bundledThemes['dark-plus']()],
      langs: [bundledLanguages['css'](), bundledLanguages['javascript']()],
    });
    await highlighter.loadLanguage(babelScriptInjection);
    await highlighter.loadLanguage(bundledLanguages['html']());

    shikiToMonaco(highlighter, monaco);
  })();
  return promise;
}

export const SHIKI_THEME_LIGHT = 'light-plus' as const;
export const SHIKI_THEME_DARK = 'dark-plus' as const;
