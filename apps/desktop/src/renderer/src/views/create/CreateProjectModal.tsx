import { getCurrentLocale, useT } from '@open-codesign/i18n';
import type { ProjectDraft, ProjectType } from '@open-codesign/shared';
import { type DemoTemplate, getDemos } from '@open-codesign/templates';
import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useCodesignStore } from '../../store';
import { FromTemplateForm, buildFromTemplateDraft } from './FromTemplateForm';
import { OtherForm, buildOtherDraft } from './OtherForm';
import { PrototypeForm, buildPrototypeDraft } from './PrototypeForm';
import { SlideDeckForm, buildSlideDeckDraft } from './SlideDeckForm';

const TYPES: ProjectType[] = ['prototype', 'slideDeck', 'template', 'other'];

export interface BuildDraftInput {
  type: ProjectType;
  name: string;
  speakerNotes: boolean;
  templateId: string;
}

export function buildDraft({
  type,
  name,
  speakerNotes,
  templateId,
}: BuildDraftInput): ProjectDraft | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  switch (type) {
    case 'prototype':
      return buildPrototypeDraft(trimmed);
    case 'slideDeck':
      return buildSlideDeckDraft(trimmed, speakerNotes);
    case 'template':
      if (!templateId) return null;
      return buildFromTemplateDraft(trimmed, templateId);
    case 'other':
      return buildOtherDraft(trimmed);
  }
}

export function CreateProjectModal() {
  const t = useT();
  const closeModal = useCodesignStore((s) => s.closeCreateProjectModal);
  const createProject = useCodesignStore((s) => s.createProject);
  const titleId = useId();

  const templates = useMemo<DemoTemplate[]>(() => getDemos(getCurrentLocale()), []);

  const [type, setType] = useState<ProjectType>('prototype');
  const [name, setName] = useState('');
  const [speakerNotes, setSpeakerNotes] = useState(true);
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? '');

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeModal();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeModal]);

  const draft = buildDraft({ type, name, speakerNotes, templateId });
  const canSubmit = draft !== null;

  function submit(): void {
    if (!draft) return;
    createProject(draft);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-[var(--space-4)]"
      // biome-ignore lint/a11y/useSemanticElements: native <dialog> conflicts with our custom backdrop click + overlay token theming.
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label={t('create.close')}
        onClick={closeModal}
        className="absolute inset-0 bg-[var(--color-overlay)]"
      />
      <div className="relative w-full max-w-[560px] max-h-[calc(100vh-var(--space-12))] overflow-y-auto rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)]">
        <header className="flex items-start justify-between gap-[var(--space-4)] px-[var(--space-6)] pt-[var(--space-6)] pb-[var(--space-3)]">
          <div className="space-y-[var(--space-1)]">
            <h2
              id={titleId}
              className="display text-[var(--text-lg)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0"
            >
              {t('create.title')}
            </h2>
            <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] m-0 leading-[var(--leading-snug)]">
              {t('create.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label={t('create.close')}
            className="inline-flex items-center justify-center w-[var(--size-control-sm)] h-[var(--size-control-sm)] rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <X className="w-[var(--size-icon-md)] h-[var(--size-icon-md)]" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label={t('create.title')}
          className="flex items-center gap-[var(--space-1)] px-[var(--space-6)] border-b border-[var(--color-border-muted)]"
        >
          {TYPES.map((kind) => {
            const active = kind === type;
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setType(kind)}
                className={`px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-sm)] border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] text-[var(--color-text-primary)] font-medium'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {t(`create.types.${kind}`)}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="px-[var(--space-6)] py-[var(--space-5)] space-y-[var(--space-4)]"
        >
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-snug)] m-0">
            {t(`create.typeDescriptions.${type}`)}
          </p>

          {type === 'prototype' ? <PrototypeForm name={name} setName={setName} /> : null}
          {type === 'slideDeck' ? (
            <SlideDeckForm
              name={name}
              setName={setName}
              speakerNotes={speakerNotes}
              setSpeakerNotes={setSpeakerNotes}
            />
          ) : null}
          {type === 'template' ? (
            <FromTemplateForm
              name={name}
              setName={setName}
              templateId={templateId}
              setTemplateId={setTemplateId}
              templates={templates}
            />
          ) : null}
          {type === 'other' ? <OtherForm name={name} setName={setName} /> : null}

          <footer className="flex items-center justify-between gap-[var(--space-3)] pt-[var(--space-2)]">
            <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
              {canSubmit ? '\u00a0' : t('create.disabledHint')}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center h-[var(--size-control-md)] px-[var(--space-5)] rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium shadow-[var(--shadow-soft)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {t('create.cta')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
