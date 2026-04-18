import { describe, expect, it } from 'vitest';
import { buildDraft } from './CreateProjectModal';

describe('CreateProjectModal.buildDraft', () => {
  it('returns null when name is empty (CTA stays disabled)', () => {
    expect(
      buildDraft({ type: 'prototype', name: '   ', speakerNotes: false, templateId: '' }),
    ).toBeNull();
  });

  it('builds a prototype draft', () => {
    const draft = buildDraft({
      type: 'prototype',
      name: '  Onboarding flow ',
      speakerNotes: false,
      templateId: '',
    });
    expect(draft).toEqual({ name: 'Onboarding flow', type: 'prototype' });
  });

  it('builds a slide-deck draft and preserves speakerNotes', () => {
    const draft = buildDraft({
      type: 'slideDeck',
      name: 'Pitch',
      speakerNotes: true,
      templateId: '',
    });
    expect(draft).toEqual({ name: 'Pitch', type: 'slideDeck', speakerNotes: true });
  });

  it('refuses a template draft when no template is picked', () => {
    expect(
      buildDraft({ type: 'template', name: 'Demo', speakerNotes: false, templateId: '' }),
    ).toBeNull();
  });

  it('builds a from-template draft when a template id is provided', () => {
    const draft = buildDraft({
      type: 'template',
      name: 'Demo',
      speakerNotes: false,
      templateId: 'meditation-app',
    });
    expect(draft).toEqual({ name: 'Demo', type: 'template', templateId: 'meditation-app' });
  });

  it('builds an other draft', () => {
    const draft = buildDraft({
      type: 'other',
      name: 'Free form',
      speakerNotes: false,
      templateId: '',
    });
    expect(draft).toEqual({ name: 'Free form', type: 'other' });
  });
});
