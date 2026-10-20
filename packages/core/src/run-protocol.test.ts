import { describe, expect, it } from 'vitest';
import { buildRunProtocolPreflight, formatRunProtocolPreflightAnswers } from './run-protocol.js';

describe('run protocol preflight', () => {
  it('retains missing-source clarification without reference evidence', () => {
    const result = buildRunProtocolPreflight({
      prompt: 'Reproduce the supplied source.',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      routerQuestions: [
        {
          id: 'missing-source-files',
          type: 'freeform',
          prompt: 'Please provide the missing source files.',
        },
      ],
    });
    expect(result.requiresClarification).toBe(true);
    expect(result.clarificationQuestions).toHaveLength(1);
  });
  it('does not invent clarification questions when the semantic router did not ask any', () => {
    const result = buildRunProtocolPreflight({
      prompt: 'make something cool',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
    });

    expect(result.requiresClarification).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
    expect(result.requiresTodosBeforeMutation).toBe(true);
  });

  it('does not ask generic local questions for non-creation operational prompts', () => {
    const result = buildRunProtocolPreflight({
      prompt: '还没看文件，先看一下实际情况',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
    });

    expect(result.requiresClarification).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
    expect(result.requiresTodosBeforeMutation).toBe(true);
  });

  it('does not ask for a specific Apple Watch run coach brief', () => {
    const result = buildRunProtocolPreflight({
      prompt:
        '设计一个 Apple Watch 风格的 run coach screen。极小视口里要显示当前距离、pace ring、heart-rate zone、haptic cue 状态、pause/resume 控制和一句 glanceable coaching message。',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
    });

    expect(result.requiresClarification).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
    expect(result.requiresTodosBeforeMutation).toBe(true);
  });

  it('uses router-authored questions and dedupes them by id', () => {
    const result = buildRunProtocolPreflight({
      prompt: 'make something cool',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      routerQuestions: [
        {
          id: 'visualDirection',
          type: 'text-options',
          prompt: '你想先走哪种 run coach 气质？',
          options: ['Apple Watch 原生感', '运动杂志感', '更强教练感'],
        },
        {
          id: 'visualDirection',
          type: 'text-options',
          prompt: 'Duplicate should be ignored',
          options: ['a', 'b'],
        },
      ],
    });

    expect(result.requiresClarification).toBe(true);
    expect(result.clarificationQuestions).toEqual([
      {
        id: 'visualDirection',
        type: 'text-options',
        prompt: '你想先走哪种 run coach 气质？',
        options: ['Apple Watch 原生感', '运动杂志感', '更强教练感'],
      },
    ]);
  });

  it('suppresses missing-source questions when the user attached reference material', () => {
    const result = buildRunProtocolPreflight({
      prompt: '复刻一下这个页面',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      attachmentCount: 1,
      routerQuestions: [
        {
          id: 'source',
          type: 'freeform',
          prompt: '请提供要复刻的页面（链接、截图说明或粘贴内容）',
          multiline: true,
        },
      ],
    });

    expect(result.requiresClarification).toBe(false);
    expect(result.clarificationQuestions).toEqual([]);
    expect(result.requiresTodosBeforeMutation).toBe(true);
  });

  it('keeps non-source clarification questions even with attached references', () => {
    const result = buildRunProtocolPreflight({
      prompt: '复刻这个页面',
      historyCount: 0,
      workspaceState: { hasSource: false },
      runPreferences: {
        schemaVersion: 1,
        tweaks: 'auto',
        bitmapAssets: 'auto',
        reusableSystem: 'auto',
      },
      attachmentCount: 1,
      routerQuestions: [
        {
          id: 'targetDevice',
          type: 'text-options',
          prompt: '首版按哪个设备尺寸做？',
          options: ['iPhone 16 Pro', '桌面端 1440px'],
        },
      ],
    });

    expect(result.requiresClarification).toBe(true);
    expect(result.clarificationQuestions).toHaveLength(1);
  });

  it('formats non-preference preflight answers for agent context', () => {
    const section = formatRunProtocolPreflightAnswers([
      { questionId: 'artifactType', value: 'mobile-app-screen' },
      { questionId: 'visualDirection', value: 'bold' },
    ]);

    expect(section).toEqual([
      ['## Preflight answers', '- artifactType: mobile-app-screen', '- visualDirection: bold'].join(
        '\n',
      ),
    ]);
  });
});
