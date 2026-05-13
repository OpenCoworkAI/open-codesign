import { describe, expect, it } from 'vitest';
import { CommentBubble, type CommentBubbleProps, QUICK_ACTION_TEXT } from './CommentBubble';

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
      onSaveAndClose: () => {},
      onSaveAndSend: () => {},
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
      onSaveAndClose: () => {},
      onSaveAndSend: (_text: string) => {},
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
