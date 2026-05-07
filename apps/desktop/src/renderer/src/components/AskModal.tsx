import { useT } from '@open-codesign/i18n';
import { Check, MessageCircleQuestion, X } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
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
 * Inline questionnaire rendered whenever main pushes `ask:request` over IPC.
 * The user's answers — or a `cancelled` marker — flow back via
 * `window.codesign.ask.resolve(requestId, result)`. It lives in the chat pane
 * so clarification feels like part of the conversation, not an app-level
 * interruption.
 */

type AnswerValue = string | number | string[] | null;

const SVG_ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'title',
  'desc',
]);

const SVG_ALLOWED_ATTRS = new Set([
  'aria-hidden',
  'aria-label',
  'class',
  'clip-path',
  'cx',
  'cy',
  'd',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-weight',
  'height',
  'id',
  'mask',
  'offset',
  'opacity',
  'points',
  'preserveAspectRatio',
  'r',
  'rx',
  'ry',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'transform',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
]);

const SAFE_SVG_IRI_RE = /^url\(#[-_a-zA-Z0-9:.]+\)$/;
const SAFE_SVG_COLOR_RE =
  /^(none|currentColor|transparent|#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)|[a-zA-Z]+)$/i;

function isSafeSvgAttrValue(name: string, value: string): boolean {
  const trimmed = value.trim();
  if (/javascript:|data:|https?:|file:|vbscript:/i.test(trimmed)) return false;
  if (name === 'fill' || name === 'stroke' || name === 'clip-path' || name === 'mask') {
    return SAFE_SVG_COLOR_RE.test(trimmed) || SAFE_SVG_IRI_RE.test(trimmed);
  }
  return true;
}

export function sanitizeInlineSvg(raw: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return '';
  }
  const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (parsed.querySelector('parsererror') !== null) return '';
  const root = parsed.documentElement;
  if (root.tagName !== 'svg') return '';

  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (!SVG_ALLOWED_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      visit(child);
    }
    for (const attr of Array.from(node.attributes)) {
      if (
        attr.name.startsWith('on') ||
        attr.name.includes(':') ||
        !SVG_ALLOWED_ATTRS.has(attr.name) ||
        !isSafeSvgAttrValue(attr.name, attr.value)
      ) {
        node.removeAttribute(attr.name);
      }
    }
  };

  visit(root);
  return new XMLSerializer().serializeToString(root);
}

export interface AskQueueState {
  active: AskRequest | null;
  queue: AskRequest[];
}

export function enqueueAskRequest(state: AskQueueState, request: AskRequest): AskQueueState {
  if (state.active === null) return { active: request, queue: state.queue };
  return { active: state.active, queue: [...state.queue, request] };
}

export function advanceAskQueue(state: AskQueueState): AskQueueState {
  const [next, ...rest] = state.queue;
  return { active: next ?? null, queue: rest };
}

export function AskModal() {
  const t = useT();
  const [askQueue, setAskQueue] = useState<AskQueueState>({ active: null, queue: [] });
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const panelRef = useRef<HTMLElement>(null);
  const pending = askQueue.active;

  useEffect(() => {
    const off = window.codesign?.ask?.onRequest?.((req) => {
      setAskQueue((prev) => enqueueAskRequest(prev, req));
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    setAnswers(pending ? initialAnswers(pending.input.questions) : {});
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    panelRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [pending]);

  const resolve = useCallback((requestId: string, result: AskResult) => {
    void window.codesign?.ask?.resolve?.(requestId, result);
    setAskQueue((prev) => advanceAskQueue(prev));
  }, []);

  const cancel = useCallback(() => {
    if (!pending) return;
    resolve(pending.requestId, { status: 'cancelled', answers: [] });
  }, [pending, resolve]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancel]);

  if (!pending) return null;

  function submit() {
    if (!pending) return;
    const collected: AskAnswer[] = pending.input.questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? null,
    }));
    resolve(pending.requestId, { status: 'answered', answers: collected });
  }

  function setValue(id: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <section
      ref={panelRef}
      aria-labelledby="ask-title"
      role="group"
      className="mt-[var(--space-5)] max-w-[92%] rounded-2xl rounded-bl-md border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-3)] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-start gap-[var(--space-2)]">
        <div className="mt-[2px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
          <MessageCircleQuestion className="h-[14px] w-[14px]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <header className="mb-[var(--space-3)]">
            <h2
              id="ask-title"
              className="text-[13px] font-[var(--font-weight-semibold)] leading-tight text-[var(--color-text-primary)]"
            >
              {t('ask.title', { defaultValue: 'Quick clarification' })}
            </h2>
            {pending.input.rationale ? (
              <p className="mt-[var(--space-1)] text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                {pending.input.rationale}
              </p>
            ) : null}
          </header>
          <div className="flex flex-col gap-[var(--space-3)]">
            {pending.input.questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                value={answers[q.id] ?? null}
                onChange={(v) => setValue(q.id, v)}
              />
            ))}
          </div>
          <footer className="mt-[var(--space-3)] flex justify-end gap-[var(--space-2)]">
            <button
              type="button"
              onClick={cancel}
              className="inline-flex h-[30px] items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-[var(--space-2_5)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
            >
              <X className="h-[13px] w-[13px]" aria-hidden />
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={submit}
              className="inline-flex h-[30px] items-center gap-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-2_5)] text-[12px] font-[var(--font-weight-semibold)] text-[var(--color-text-on-accent)] hover:opacity-90"
            >
              <Check className="h-[13px] w-[13px]" aria-hidden />
              {t('ask.submit', { defaultValue: 'Answer' })}
            </button>
          </footer>
        </div>
      </div>
    </section>
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
    <div className="flex flex-col gap-[var(--space-1_5)]">
      <label
        htmlFor={`ask-q-${question.id}`}
        className="text-[12.5px] font-[var(--font-weight-medium)] leading-snug text-[var(--color-text-primary)]"
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
      <div className="flex flex-col gap-[var(--space-1)]">
        {q.options.map((opt) => (
          <label
            key={opt}
            className="flex min-w-0 items-start gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-transparent px-[var(--space-2)] py-[var(--space-1_5)] text-[12.5px] leading-snug text-[var(--color-text-primary)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]"
          >
            <input
              type="checkbox"
              className="mt-[2px] shrink-0"
              checked={selected.has(opt)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(opt);
                else next.delete(opt);
                onChange([...next]);
              }}
            />
            <span className="min-w-0 break-words">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  const current = typeof value === 'string' ? value : '';
  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      {q.options.map((opt) => (
        <label
          key={opt}
          className={`flex min-w-0 items-start gap-[var(--space-2)] rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-1_5)] text-[12.5px] leading-snug text-[var(--color-text-primary)] transition-colors ${
            current === opt
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
              : 'border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]'
          }`}
        >
          <input
            type="radio"
            name={`ask-q-${q.id}`}
            className="mt-[2px] shrink-0"
            checked={current === opt}
            onChange={() => onChange(opt)}
          />
          <span className="min-w-0 break-words">{opt}</span>
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
    <div className="grid grid-cols-2 gap-[var(--space-2)]">
      {q.options.map((opt) => {
        const selected = current === opt.id;
        return (
          <button
            type="button"
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`flex min-w-0 flex-col items-stretch gap-[var(--space-2)] rounded-[var(--radius-md)] border p-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors ${
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-surface-raised)]'
                : 'border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-raised)]'
            }`}
          >
            <div
              aria-hidden
              className="aspect-square w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)]"
              // Agent output is untrusted: sanitize SVG options before using
              // the remaining bounded inline-SVG sink in the privileged UI.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized inert inline SVG
              dangerouslySetInnerHTML={{ __html: sanitizeInlineSvg(opt.svg) }}
            />
            <span className="break-words">{opt.label}</span>
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
    <div className="flex items-center gap-[var(--space-2)]">
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
      <span className="min-w-[3rem] text-right font-[var(--font-mono)] text-[12px] text-[var(--color-text-primary)]">
        {current}
        {q.unit ? ` ${q.unit}` : ''}
      </span>
    </div>
  );
}

function FileField({ q, onChange }: { q: AskFileQuestion; onChange: (v: AnswerValue) => void }) {
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
      className="max-w-full text-[12.5px] text-[var(--color-text-primary)]"
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
