import { describe, expect, it } from 'vitest';
import {
  CommentBubble,
  type CommentBubbleProps,
  commentBubblePosition,
  commentKeyAction,
  commentRectInWindow,
  QUICK_ACTION_TEXT,
} from './CommentBubble';

describe('comment composer keyboard intent', () => {
  const event = { key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false };
  it('never submits or closes an active composition', () => {
    expect(commentKeyAction({ ...event, isComposing: true })).toBeNull();
    expect(commentKeyAction({ ...event, keyCode: 229 })).toBeNull();
    expect(commentKeyAction({ ...event, key: 'Escape', isComposing: true })).toBeNull();
  });
  it('preserves Enter for multiline drafts and accepts explicit submit/dismiss shortcuts', () => {
    expect(commentKeyAction({ ...event, ctrlKey: false })).toBeNull();
    expect(commentKeyAction(event)).toBe('send');
    expect(commentKeyAction({ ...event, ctrlKey: false, metaKey: true })).toBe('send');
    expect(commentKeyAction({ ...event, key: 'Escape' })).toBe('dismiss');
  });
});

describe('comment composer edge placement', () => {
  it('prefers space above a bottom-edge target instead of covering it', () => {
    expect(
      commentBubblePosition(
        { top: 580, left: 280, width: 40, height: 40 },
        { width: 286, height: 260 },
        { width: 310, height: 640 },
      ),
    ).toEqual({ top: 312, left: 12 });
  });
  it('keeps all four edge anchors bounded across narrow and short viewports', () => {
    for (const width of [310, 640, 768, 1280, 1600]) {
      for (const height of [400, 640, 800]) {
        for (const left of [-200, 0, width - 10]) {
          for (const top of [-200, 0, height - 10]) {
            const bubble = { width: Math.min(360, width - 24), height: 300 };
            const p = commentBubblePosition({ left, top, width: 40, height: 40 }, bubble, {
              width,
              height,
            });
            expect(p.left).toBeGreaterThanOrEqual(12);
            expect(p.top).toBeGreaterThanOrEqual(12);
            expect(p.left + bubble.width).toBeLessThanOrEqual(width - 12);
            expect(p.top + bubble.height).toBeLessThanOrEqual(height - 12);
          }
        }
      }
    }
  });
});

describe('comment bubble iframe coordinates', () => {
  it.each([0.5, 1, 1.5])('maps iframe-local rectangles to the portal at scale %s', (scale) => {
    expect(
      commentRectInWindow(
        { top: 80, left: 120, width: 200, height: 40 },
        { top: 170, left: 320, width: 800 * scale, height: 600 * scale },
        { width: 800, height: 600 },
      ),
    ).toEqual({
      top: 170 + 80 * scale,
      left: 320 + 120 * scale,
      width: 200 * scale,
      height: 40 * scale,
    });
  });
});

describe('CommentBubble module', () => {
  it('exports the component', () => {
    expect(typeof CommentBubble).toBe('function');
  });

  it('props type includes required rect fields', () => {
    const props: CommentBubbleProps = {
      selector: '#x',
      tag: 'div',
      outerHTML: '<div/>',
      rect: { top: 0, left: 0, width: 1, height: 1 },
      onDismiss: () => {},
      onSaveAndClose: () => true,
      onSaveAndSend: () => true,
    };
    expect(props.rect.top).toBe(0);
  });

  it('accepts the optional initialText prop', () => {
    const props: CommentBubbleProps = {
      selector: '#x',
      tag: 'div',
      outerHTML: '<div/>',
      rect: { top: 0, left: 0, width: 1, height: 1 },
      initialText: 'make it bigger',
      onDismiss: () => {},
      onSaveAndClose: () => true,
      onSaveAndSend: (_text: string) => true,
    };
    expect(props.initialText).toBe('make it bigger');
  });
});

describe('CommentBubble quick actions', () => {
  it('exposes 8 preset texts covering spacing/contrast/font/radius', () => {
    const ids = Object.keys(QUICK_ACTION_TEXT);
    expect(ids).toHaveLength(8);
    expect(ids).toEqual(
      expect.arrayContaining([
        'spacing-more',
        'spacing-less',
        'contrast-more',
        'contrast-less',
        'font-bigger',
        'font-smaller',
        'radius-more',
        'radius-less',
      ]),
    );
  });

  it('preset texts are stable English strings the LLM can read directly', () => {
    expect(QUICK_ACTION_TEXT['spacing-more']).toBe('increase spacing on this element');
    expect(QUICK_ACTION_TEXT['radius-less']).toBe('make corners sharper');
  });
});
