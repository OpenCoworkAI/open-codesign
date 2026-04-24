import { type ReactElement, useEffect, useState } from 'react';
import type {
  AskAnswer,
  AskFileQuestion,
  AskFreeformQuestion,
  AskQuestion,
  AskRequest,
  AskResult,
  AskSliderQuestion,
  AskSvgOptionsQuestion,
  AskTextOptionsQuestion,
} from '../../../preload/index';

/**
 * Questionnaire modal rendered whenever main pushes `ask:request` over IPC.
 * The user's answers — or a `cancelled` marker — flow back via
 * `window.codesign.ask.resolve(requestId, result)`. Tokens only; no hardcoded
 * colors or sizes.
 */

type AnswerValue = string | number | string[] | null;

export function AskModal() {
  const [pending, setPending] = useState<AskRequest | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});

  useEffect(() => {
    const off = window.codesign?.ask?.onRequest?.((req) => {
      setPending(req);
      setAnswers(initialAnswers(req.input.questions));
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  function resolve(result: AskResult) {
    if (!pending) return;
    void window.codesign?.ask?.resolve?.(pending.requestId, result);
    setPending(null);
    setAnswers({});
  }

  function submit() {
    if (!pending) return;
    const collected: AskAnswer[] = pending.input.questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? null,
    }));
    resolve({ status: 'answered', answers: collected });
  }

  function cancel() {
    resolve({ status: 'cancelled', answers: [] });
  }

  function setValue(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--color-overlay-scrim)] p-[var(--space-4)]"
    >
      <div className="max-h-[calc(100vh-4rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-[var(--space-6)] shadow-[var(--shadow-overlay)]">
        <header className="mb-[var(--space-4)]">
          <h2
            id="ask-title"
            className="text-[var(--text-base)] font-[var(--font-weight-semibold)] text-[var(--color-text-primary)]"
          >
            A few quick questions
          </h2>
          {pending.input.rationale ? (
            <p className="mt-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-secondary)]">
              {pending.input.rationale}
            </p>
          ) : null}
        </header>
        <div className="flex flex-col gap-[var(--space-5)]">
          {pending.input.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={answers[q.id] ?? null}
              onChange={(v) => setValue(q.id, v)}
            />
          ))}
        </div>
        <footer className="mt-[var(--space-6)] flex justify-end gap-[var(--space-2)]">
          <button
            type="button"
            onClick={cancel}
            className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-sm)] font-[var(--font-weight-semibold)] text-[var(--color-text-on-accent)] hover:opacity-90"
          >
            Submit
          </button>
        </footer>
      </div>
    </div>
  );
}

function initialAnswers(questions: AskQuestion[]): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const q of questions) {
    if (q.type === 'slider') out[q.id] = q.default ?? q.min;
    else if (q.type === 'text-options' && q.multi) out[q.id] = [];
    else out[q.id] = null;
  }
  return out;
}

interface FieldProps {
  question: AskQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}

function QuestionField({ question, value, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label
        htmlFor={`ask-q-${question.id}`}
        className="text-[var(--text-sm)] font-[var(--font-weight-medium)] text-[var(--color-text-primary)]"
      >
        {question.prompt}
      </label>
      {renderControl(question, value, onChange)}
    </div>
  );
}

function renderControl(
  q: AskQuestion,
  value: AnswerValue,
  onChange: (v: AnswerValue) => void,
): ReactElement {
  switch (q.type) {
    case 'text-options':
      return <TextOptions q={q} value={value} onChange={onChange} />;
    case 'svg-options':
      return <SvgOptions q={q} value={value} onChange={onChange} />;
    case 'slider':
      return <SliderField q={q} value={value} onChange={onChange} />;
    case 'file':
      return <FileField q={q} onChange={onChange} />;
    case 'freeform':
      return <FreeformField q={q} value={value} onChange={onChange} />;
  }
}

function TextOptions({
  q,
  value,
  onChange,
}: {
  q: AskTextOptionsQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  if (q.multi) {
    const selected = new Set<string>(Array.isArray(value) ? value : []);
    return (
      <div className="flex flex-col gap-[var(--space-2)]">
        {q.options.map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)]"
          >
            <input
              type="checkbox"
              checked={selected.has(opt)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(opt);
                else next.delete(opt);
                onChange([...next]);
              }}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }
  const current = typeof value === 'string' ? value : '';
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      {q.options.map((opt) => (
        <label
          key={opt}
          className="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)]"
        >
          <input
            type="radio"
            name={`ask-q-${q.id}`}
            checked={current === opt}
            onChange={() => onChange(opt)}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function SvgOptions({
  q,
  value,
  onChange,
}: {
  q: AskSvgOptionsQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const current = typeof value === 'string' ? value : '';
  return (
    <div className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-3">
      {q.options.map((opt) => {
        const selected = current === opt.id;
        return (
          <button
            type="button"
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`flex flex-col items-stretch gap-[var(--space-2)] rounded-[var(--radius-md)] border p-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors ${
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-surface-raised)]'
                : 'border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]'
            }`}
          >
            <div
              aria-hidden
              className="aspect-square w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)]"
              // SVG content comes from the agent's own tool call, which is
              // trusted in this flow (it's the model's structured output, not
              // user-supplied HTML). Still bounded to the inline svg string.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted agent-authored SVG
              dangerouslySetInnerHTML={{ __html: opt.svg }}
            />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SliderField({
  q,
  value,
  onChange,
}: {
  q: AskSliderQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const current = typeof value === 'number' ? value : (q.default ?? q.min);
  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <input
        id={`ask-q-${q.id}`}
        type="range"
        min={q.min}
        max={q.max}
        step={q.step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="min-w-[3rem] text-right font-[var(--font-mono)] text-[var(--text-sm)] text-[var(--color-text-primary)]">
        {current}
        {q.unit ? ` ${q.unit}` : ''}
      </span>
    </div>
  );
}

function FileField({
  q,
  onChange,
}: {
  q: AskFileQuestion;
  onChange: (v: AnswerValue) => void;
}) {
  return (
    <input
      id={`ask-q-${q.id}`}
      type="file"
      accept={q.accept?.join(',')}
      multiple={q.multiple}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) {
          onChange(null);
          return;
        }
        if (q.multiple) onChange(files.map((f) => f.name));
        else onChange(files[0]?.name ?? null);
      }}
      className="text-[var(--text-sm)] text-[var(--color-text-primary)]"
    />
  );
}

function FreeformField({
  q,
  value,
  onChange,
}: {
  q: AskFreeformQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
}) {
  const current = typeof value === 'string' ? value : '';
  if (q.multiline) {
    return (
      <textarea
        id={`ask-q-${q.id}`}
        value={current}
        placeholder={q.placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)]"
      />
    );
  }
  return (
    <input
      id={`ask-q-${q.id}`}
      type="text"
      value={current}
      placeholder={q.placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-[var(--space-2)] text-[var(--text-sm)] text-[var(--color-text-primary)]"
    />
  );
}
