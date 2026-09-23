import { useT } from '@open-codesign/i18n';
import type { AskCancelledV1 } from '@open-codesign/shared';
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
import { fileListToWorkspaceImport } from '../lib/file-ingest';
import { useCodesignStore } from '../store';

/**
 * Inline questionnaire rendered whenever main pushes `ask:request` over IPC.
 * The user's answers — or a `cancelled` marker — flow back via
 * `window.codesign.ask.resolve(requestId, result)`. It lives in the chat pane
 * so clarification feels like part of the conversation, not an app-level
 * interruption.
 */

export type AnswerValue = string | number | string[] | null;
type FileImportHandler = (files: readonly File[]) => Promise<string[]>;

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
  if (state.active?.requestId === request.requestId) return state;
  if (state.queue.some((item) => item.requestId === request.requestId)) return state;
  if (state.active === null) return { active: request, queue: state.queue };
  return { active: state.active, queue: [...state.queue, request] };
}

export function enqueueAskRequests(state: AskQueueState, requests: AskRequest[]): AskQueueState {
  return requests.reduce((next, request) => enqueueAskRequest(next, request), state);
}

export function advanceAskQueue(state: AskQueueState): AskQueueState {
  const [next, ...rest] = state.queue;
  return { active: next ?? null, queue: rest };
}

export function dismissAskRequest(
  state: AskQueueState,
  request: Pick<AskRequest, 'requestId' | 'sessionId'>,
): AskQueueState {
  const matches = (item: AskRequest) =>
    item.requestId === request.requestId && item.sessionId === request.sessionId;
  const queue = state.queue.filter((item) => !matches(item));
  if (state.active && matches(state.active)) return advanceAskQueue({ active: null, queue });
  return queue.length === state.queue.length ? state : { active: state.active, queue };
}

export function answerValueForImportedFiles(input: {
  importedPaths: readonly string[];
  selectedNames: readonly string[];
  multiple?: boolean | undefined;
}): AnswerValue {
  const values = input.importedPaths.length > 0 ? input.importedPaths : input.selectedNames;
  if (values.length === 0) return null;
  return input.multiple ? [...values] : (values[0] ?? null);
}

export function removeAskRequest(state: AskQueueState, requestId: string): AskQueueState {
  if (state.active?.requestId === requestId) return advanceAskQueue(state);
  return {
    active: state.active,
    queue: state.queue.filter((request) => request.requestId !== requestId),
  };
}

export function askBelongsToDesign(
  request: AskRequest,
  designId: string | null,
  runId: string | null,
): boolean {
  if (!designId) return false;
  if (request.designId) return request.designId === designId;
  return request.sessionId === designId || (request.runId ?? request.sessionId) === runId;
}

type AskIdentity = Pick<AskRequest, 'requestId' | 'sessionId'>;
const requestKey = (request: AskIdentity) => JSON.stringify([request.sessionId, request.requestId]);

const draftKey = (requestId: string) => `codesign:ask-draft:${requestId}`;

function clearDraft(requestId: string): void {
  try {
    window.localStorage.removeItem(draftKey(requestId));
  } catch {
    /* Storage may be disabled. */
  }
}

export function readAskDraft(request: AskRequest): Record<string, AnswerValue> {
  const answers = initialAnswers(request.input.questions);
  try {
    const raw: unknown = JSON.parse(
      window.localStorage.getItem(draftKey(request.requestId)) ?? 'null',
    );
    if (!raw || typeof raw !== 'object') return answers;
    const record = raw as { schemaVersion?: unknown; answers?: unknown };
    if (record.schemaVersion !== 1 || !record.answers || typeof record.answers !== 'object')
      return answers;
    const saved = record.answers as Record<string, unknown>;
    for (const question of request.input.questions) {
      const value = saved[question.id];
      if (
        value === null ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (Array.isArray(value) && value.every((item) => typeof item === 'string'))
      ) {
        answers[question.id] = value as AnswerValue;
      }
    }
  } catch {
    /* A malformed or unavailable draft must not block the question. */
  }
  return answers;
}

export function AskModal() {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const activeGenerationId = useCodesignStore((s) => s.activeGenerationId);
  const [askQueue, setAskQueue] = useState<AskQueueState>({ active: null, queue: [] });
  const queueRef = useRef(askQueue);
  const updateQueue = useCallback((change: (state: AskQueueState) => AskQueueState) => {
    queueRef.current = change(queueRef.current);
    setAskQueue(queueRef.current);
  }, []);
  const resolved = useRef(new Set<string>());
  const remove = useCallback(
    (request: AskIdentity) => {
      resolved.current.add(requestKey(request));
      const state = queueRef.current;
      const known = [state.active, ...state.queue].find(
        (item) => item?.requestId === request.requestId,
      );
      if (!known || known.sessionId === request.sessionId) clearDraft(request.requestId);
      updateQueue((previous) => dismissAskRequest(previous, request));
    },
    [updateQueue],
  );
  const isActive = useCallback((request: AskRequest) => {
    const state = useCodesignStore.getState();
    const queue = queueRef.current;
    const requests = queue.active ? [queue.active, ...queue.queue] : queue.queue;
    return (
      !resolved.current.has(requestKey(request)) &&
      requests.find((candidate) =>
        askBelongsToDesign(candidate, state.currentDesignId, state.activeGenerationId),
      ) === request
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    const off = window.codesign?.ask?.onRequest?.((request) => {
      if (!resolved.current.has(requestKey(request)))
        updateQueue((previous) => enqueueAskRequest(previous, request));
    });
    const offResolved = window.codesign?.ask?.onResolved?.(remove);
    const offCancelled = window.codesign?.ask?.onCancelled?.((event: AskCancelledV1) =>
      remove(event),
    );
    const recover = () => {
      if (disposed) return;
      void window.codesign?.ask
        ?.pending?.()
        .then((requests) => {
          if (disposed) return;
          updateQueue((previous) =>
            enqueueAskRequests(
              previous,
              requests.filter((request) => !resolved.current.has(requestKey(request))),
            ),
          );
        })
        .catch(() => {
          // Live delivery remains available if a recovery read fails.
        });
      void window.codesign?.ask
        ?.history?.()
        .then((history) => {
          if (disposed) return;
          for (const entry of history) {
            if (entry.status !== 'pending') remove(entry);
          }
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover();
    };
    window.addEventListener('focus', recover);
    document.addEventListener('visibilitychange', onVisibility);
    recover();
    return () => {
      disposed = true;
      queueRef.current = { active: null, queue: [] };
      off?.();
      offResolved?.();
      offCancelled?.();
      window.removeEventListener('focus', recover);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [remove, updateQueue]);

  const requests = askQueue.active ? [askQueue.active, ...askQueue.queue] : askQueue.queue;
  const pending = requests.find((request) =>
    askBelongsToDesign(request, currentDesignId, activeGenerationId),
  );
  return pending ? (
    <AskPrompt
      key={requestKey(pending)}
      pending={pending}
      onResolved={remove}
      isActive={isActive}
    />
  ) : null;
}

function AskPrompt({
  pending,
  onResolved,
  isActive,
}: {
  pending: AskRequest;
  onResolved: (request: AskIdentity) => void;
  isActive: (request: AskRequest) => boolean;
}) {
  const t = useT();
  const importFilesToWorkspace = useCodesignStore((s) => s.importFilesToWorkspace);
  const setSidebarCollapsed = useCodesignStore((s) => s.setSidebarCollapsed);
  const setPreviewFullscreen = useCodesignStore((s) => s.setPreviewFullscreen);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => readAskDraft(pending));
  const answersRef = useRef(answers);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!pending) return;
    setSidebarCollapsed(false);
    setPreviewFullscreen(false);
    const frame = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [pending, setSidebarCollapsed, setPreviewFullscreen]);

  const resolve = useCallback(
    async (requestId: string, result: AskResult) => {
      if (inFlight.current || !isActive(pending)) return;
      inFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        if (!window.codesign?.ask?.resolve) throw new Error('Question service unavailable');
        await window.codesign.ask.resolve(requestId, result);
        onResolved(pending);
      } catch (failure) {
        if (mounted.current)
          setError(
            failure instanceof Error ? failure.message : 'Could not save the answer. Please retry.',
          );
      } finally {
        inFlight.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    [onResolved, isActive, pending],
  );

  const cancel = useCallback(() => {
    if (!pending) return;
    void resolve(pending.requestId, { status: 'cancelled', answers: [] });
  }, [pending, resolve]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        panelRef.current?.getClientRects().length
      ) {
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancel]);

  const importQuestionFiles = useCallback<FileImportHandler>(
    async (files) => {
      const designId = pending.designId ?? useCodesignStore.getState().currentDesignId;
      const input = await fileListToWorkspaceImport(files);
      if (!mounted.current || !isActive(pending)) {
        throw new Error('The file question is no longer active.');
      }
      if (useCodesignStore.getState().currentDesignId !== designId) {
        throw new Error('The active design changed before file import');
      }
      const imported = await importFilesToWorkspace({ source: 'composer', ...input });
      return imported.map((file) => file.path);
    },
    [importFilesToWorkspace, pending, isActive],
  );

  if (!pending) return null;

  function submit() {
    if (!pending) return;
    const collected: AskAnswer[] = pending.input.questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? null,
    }));
    void resolve(pending.requestId, { status: 'answered', answers: collected });
  }

  function setValue(id: string, value: AnswerValue) {
    if (!mounted.current || !isActive(pending)) return;
    const next = { ...answersRef.current, [id]: value };
    answersRef.current = next;
    setAnswers(next);
    try {
      window.localStorage.setItem(
        draftKey(pending.requestId),
        JSON.stringify({ schemaVersion: 1, answers: next }),
      );
    } catch {
      /* Retain the in-memory answer when localStorage is unavailable. */
    }
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
                key={JSON.stringify([pending.sessionId, pending.requestId, q.id])}
                question={q}
                value={answers[q.id] ?? null}
                onChange={(v) => setValue(q.id, v)}
                onImportFiles={importQuestionFiles}
              />
            ))}
          </div>
          {error ? (
            <p role="alert" className="mt-[var(--space-2)] text-[12px] text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
          <footer className="mt-[var(--space-3)] flex justify-end gap-[var(--space-2)]">
            <button
              type="button"
              disabled={submitting}
              onClick={cancel}
              className="inline-flex h-[30px] items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] px-[var(--space-2_5)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]"
            >
              <X className="h-[13px] w-[13px]" aria-hidden />
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              disabled={submitting}
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
  onImportFiles: FileImportHandler;
}

function QuestionField({ question, value, onChange, onImportFiles }: FieldProps) {
  return (
    <div className="flex flex-col gap-[var(--space-1_5)]">
      <label
        htmlFor={`ask-q-${question.id}`}
        className="text-[12.5px] font-[var(--font-weight-medium)] leading-snug text-[var(--color-text-primary)]"
      >
        {question.prompt}
      </label>
      {renderControl(question, value, onChange, onImportFiles)}
    </div>
  );
}

function renderControl(
  q: AskQuestion,
  value: AnswerValue,
  onChange: (v: AnswerValue) => void,
  onImportFiles: FileImportHandler,
): ReactElement {
  switch (q.type) {
    case 'text-options':
      return <TextOptions q={q} value={value} onChange={onChange} />;
    case 'svg-options':
      return <SvgOptions q={q} value={value} onChange={onChange} />;
    case 'slider':
      return <SliderField q={q} value={value} onChange={onChange} />;
    case 'file':
      return <FileField q={q} value={value} onChange={onChange} onImportFiles={onImportFiles} />;
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

function FileField({
  q,
  value,
  onChange,
  onImportFiles,
}: {
  q: AskFileQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  onImportFiles: FileImportHandler;
}) {
  const t = useT();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      onChange(null);
      return;
    }
    const selectedNames = files.map((file) => file.name);
    setImporting(true);
    setError(null);
    try {
      const importedPaths = await onImportFiles(files);
      onChange(answerValueForImportedFiles({ importedPaths, selectedNames, multiple: q.multiple }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File import failed');
      onChange(
        answerValueForImportedFiles({ importedPaths: [], selectedNames, multiple: q.multiple }),
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-1)]">
      <input
        id={`ask-q-${q.id}`}
        type="file"
        accept={q.accept?.join(',')}
        multiple={q.multiple}
        disabled={importing}
        aria-busy={importing}
        onChange={(e) => {
          void handleFiles(e.currentTarget.files);
        }}
        className="max-w-full text-[12.5px] text-[var(--color-text-primary)]"
      />
      {typeof value === 'string' || Array.isArray(value) ? (
        <p className="break-words text-[11px] text-[var(--color-text-secondary)]">
          {Array.isArray(value) ? value.join(', ') : value}
        </p>
      ) : null}
      {importing ? (
        <p className="text-[11px] text-[var(--color-text-secondary)]">
          {t('common.loading', { defaultValue: 'Loading...' })}
        </p>
      ) : null}
      {error ? (
        <p className="text-[11px] text-[var(--color-danger)]">
          {t('ask.fileImportFallback', {
            defaultValue: 'Could not import the file automatically; sending the file name instead.',
          })}
        </p>
      ) : null}
    </div>
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
