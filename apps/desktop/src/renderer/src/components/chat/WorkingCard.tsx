import type { ChatToolCallPayload } from '@open-codesign/shared';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Eye,
  FileEdit,
  FilePlus,
  FolderTree,
  Globe,
  ListChecks,
  type LucideIcon,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';

export interface WorkingCardProps {
  calls: ChatToolCallPayload[];
}

/**
 * Renders a tight vertical cluster of tool rows — no border, no card.
 * `set_todos` is omitted here (and not rendered inline in ChatMessageList);
 * the sidebar sticky header shows the live checklist.
 */
export function WorkingCard({ calls }: WorkingCardProps) {
  const rows = useMemo(() => buildRows(calls).filter((r) => !r.todos), [calls]);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-[var(--space-1)]">
      {rows.map((row) => (
        <ToolRowView key={row.key} row={row} />
      ))}
    </div>
  );
}

/**
 * Inline todo list — driven by the most recent `set_todos` payload at this
 * chronological position. Consumers (ChatMessageList) flush the tool bucket
 * before rendering one of these so the checklist sits where the agent actually
 * called the tool, not pinned to the end of the cluster.
 */
export function InlineTodoList({ call }: { call: ChatToolCallPayload }) {
  const todos = useMemo(() => extractTodos(call), [call]);
  if (todos.length === 0) return null;
  return <TodoListView todos={todos} />;
}

interface TodoItem {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface ToolRow {
  key: string;
  Icon: LucideIcon;
  label: string;
  detail: string | null;
  status: 'running' | 'done' | 'error';
  todos?: TodoItem[];
  editCount?: number;
  /** Rich inline content snippet shown below the header line. */
  snippet?: ToolSnippet;
}

type ToolSnippet =
  | { kind: 'diff'; minus: string; plus: string }
  | { kind: 'text'; lines: string[] }
  | { kind: 'range'; start: number; end: number };

function extractTodos(call: ChatToolCallPayload): TodoItem[] {
  const raw = (call.args?.['todos'] as unknown) ?? (call.args?.['items'] as unknown) ?? null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it): TodoItem | null => {
      if (typeof it !== 'object' || it === null) return null;
      const o = it as Record<string, unknown>;
      const text =
        typeof o['content'] === 'string'
          ? (o['content'] as string)
          : typeof o['text'] === 'string'
            ? (o['text'] as string)
            : null;
      if (text === null) return null;
      const rawStatus = o['status'];
      const status: TodoItem['status'] =
        rawStatus === 'completed' || rawStatus === 'in_progress' || rawStatus === 'pending'
          ? rawStatus
          : o['checked'] === true
            ? 'completed'
            : 'pending';
      return { text, status };
    })
    .filter((x): x is TodoItem => x !== null);
}

function firstMeaningfulLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 120);
  }
  return text.slice(0, 120).trim();
}

function computeSnippet(call: ChatToolCallPayload): ToolSnippet | undefined {
  if (call.toolName !== 'str_replace_based_edit_tool' && call.toolName !== 'text_editor') return;
  const cmd = call.command;
  const args = call.args;
  if (cmd === 'str_replace') {
    const minus =
      typeof args?.['old_str'] === 'string' ? firstMeaningfulLine(args['old_str']) : null;
    const plus =
      typeof args?.['new_str'] === 'string' ? firstMeaningfulLine(args['new_str']) : null;
    if (minus && plus && minus !== plus) return { kind: 'diff', minus, plus };
  }
  if (cmd === 'create' || cmd === 'insert') {
    const src =
      typeof args?.['file_text'] === 'string'
        ? args['file_text']
        : typeof args?.['new_str'] === 'string'
          ? args['new_str']
          : null;
    if (src) {
      const lines = src
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (lines.length > 0) return { kind: 'text', lines };
    }
  }
  if (cmd === 'view') {
    const range = args?.['view_range'];
    if (Array.isArray(range) && typeof range[0] === 'number' && typeof range[1] === 'number') {
      return { kind: 'range', start: range[0] as number, end: range[1] as number };
    }
  }
}

function isEditCommand(call: ChatToolCallPayload): boolean {
  return call.command === 'str_replace' || call.command === 'insert';
}

function isCreateCommand(call: ChatToolCallPayload): boolean {
  return call.command === 'create';
}

function isTextEditorTool(call: ChatToolCallPayload): boolean {
  return call.toolName === 'str_replace_based_edit_tool' || call.toolName === 'text_editor';
}

function pathOf(call: ChatToolCallPayload): string | null {
  const p = call.args?.['path'];
  return typeof p === 'string' ? p : null;
}

function iconAndLabel(call: ChatToolCallPayload): { Icon: LucideIcon; label: string } {
  if (call.toolName === 'set_todos') return { Icon: ListChecks, label: 'set_todos' };
  if (call.toolName === 'load_skill') return { Icon: Sparkles, label: 'load_skill' };
  if (call.toolName === 'verify_html') return { Icon: CheckCircle2, label: 'verify_html' };
  if (call.toolName === 'read_url') return { Icon: Globe, label: 'read_url' };
  if (call.toolName === 'read_design_system')
    return { Icon: BookOpen, label: 'read_design_system' };
  if (call.toolName === 'list_files') return { Icon: FolderTree, label: 'list_files' };
  if (call.toolName === 'str_replace_based_edit_tool' || call.toolName === 'text_editor') {
    if (call.command === 'view') return { Icon: Eye, label: 'view' };
    if (isCreateCommand(call)) return { Icon: FilePlus, label: 'create' };
    if (isEditCommand(call)) return { Icon: FileEdit, label: 'edit' };
    return { Icon: FileEdit, label: call.command ?? 'edit' };
  }
  return { Icon: Wrench, label: call.toolName };
}

function detailOf(call: ChatToolCallPayload): string | null {
  const path = pathOf(call);
  if (path) return path;
  const name = call.args?.['name'];
  if (typeof name === 'string') return name;
  const url = call.args?.['url'];
  if (typeof url === 'string') return url;
  return null;
}

export function buildRows(calls: ChatToolCallPayload[]): ToolRow[] {
  const rows: ToolRow[] = [];
  let lastEditIdx = -1;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    if (!call) continue;

    // Internal signal tools — hide from UI
    if (call.toolName === 'done') continue;

    if (call.toolName === 'set_todos') {
      const items = extractTodos(call);
      const existingIdx = rows.findIndex((r) => r.todos !== undefined);
      const existing = existingIdx >= 0 ? rows[existingIdx] : undefined;
      const row: ToolRow = {
        key: `todos-${i}`,
        Icon: ListChecks,
        label: 'set_todos',
        detail: null,
        status: call.status,
        todos: items.length > 0 ? items : (existing?.todos ?? items),
      };
      if (existingIdx >= 0) {
        rows[existingIdx] = row;
      } else {
        rows.push(row);
      }
      continue;
    }

    const { Icon, label } = iconAndLabel(call);
    const detail = detailOf(call);
    const isFileEdit = isTextEditorTool(call) && Boolean(detail);

    if (isFileEdit && detail) {
      const candidateIdx =
        lastEditIdx >= 0 && rows[lastEditIdx]?.detail === detail ? lastEditIdx : -1;
      const last = candidateIdx >= 0 ? rows[candidateIdx] : undefined;
      if (last) {
        last.editCount = (last.editCount ?? 1) + 1;
        last.label = 'edit';
        last.Icon = FileEdit;
        if (call.status === 'running') last.status = 'running';
        else if (call.status === 'error') last.status = 'error';
        else if (last.status !== 'running' && last.status !== 'error') last.status = 'done';
        continue;
      }
    }

    const snippet = computeSnippet(call);
    rows.push({
      key: `c-${i}`,
      Icon,
      label,
      detail,
      status: call.status,
      ...(snippet !== undefined ? { snippet } : {}),
    });
    if (isFileEdit) lastEditIdx = rows.length - 1;
  }
  return rows;
}

/* ── Todo checklist card ────────────────────────────────────────────── */

function TodoListView({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((it) => it.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2_5)] space-y-[var(--space-2)]">
      {/* Progress header */}
      <div className="flex items-center gap-[var(--space-2)]">
        <ListChecks
          className="w-[13px] h-[13px] shrink-0 text-[var(--color-text-muted)]"
          aria-hidden
        />
        <div className="flex-1 h-[3px] rounded-full bg-[var(--color-background-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-[var(--color-text-muted)] shrink-0">
          {done}/{total}
        </span>
      </div>
      {/* Items */}
      <div className="space-y-[3px]">
        {todos.map((todo, i) => (
          <div
            key={`${i}-${todo.text.slice(0, 12)}`}
            className="flex items-start gap-[var(--space-2)] text-[12.5px] leading-[1.4]"
          >
            {todo.status === 'completed' ? (
              <span className="mt-[2px] inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px] bg-[var(--color-accent)] shrink-0">
                <Check className="w-[10px] h-[10px] text-white" strokeWidth={3} />
              </span>
            ) : todo.status === 'in_progress' ? (
              <span className="mt-[2px] inline-block w-[14px] h-[14px] rounded-[3px] border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 shrink-0 animate-pulse" />
            ) : (
              <span className="mt-[2px] inline-block w-[14px] h-[14px] rounded-[3px] border border-[var(--color-border)] shrink-0" />
            )}
            <span
              className={
                todo.status === 'completed'
                  ? 'line-through text-[var(--color-text-muted)]'
                  : todo.status === 'in_progress'
                    ? 'text-[var(--color-text-primary)] font-medium'
                    : 'text-[var(--color-text-primary)]'
              }
            >
              {todo.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Individual tool row ────────────────────────────────────────────── */

function ToolRowView({ row }: { row: ToolRow }) {
  const { Icon } = row;
  const detailText =
    row.detail && row.editCount && row.editCount > 1
      ? `${row.detail} (${row.editCount} edits)`
      : row.detail;

  return (
    <div className="py-[2px]" title={detailText ?? row.label}>
      {/* Header line */}
      <div className="flex items-center gap-[6px] text-[12.5px]">
        {row.status === 'running' ? (
          <span className="relative inline-flex w-[14px] h-[14px] items-center justify-center shrink-0">
            <span className="absolute inline-block w-[7px] h-[7px] rounded-full bg-[var(--color-accent)] animate-pulse" />
            <span className="absolute inline-block w-[12px] h-[12px] rounded-full border border-[var(--color-accent)]/30 animate-ping" />
          </span>
        ) : row.status === 'error' ? (
          <Icon className="w-[14px] h-[14px] shrink-0 text-[var(--color-error)]" aria-hidden />
        ) : (
          <Icon className="w-[14px] h-[14px] shrink-0 text-[var(--color-text-muted)]" aria-hidden />
        )}
        <span className="font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[var(--color-text-secondary)]">
          {row.label}
        </span>
        {detailText ? (
          <span className="font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[var(--color-text-primary)] truncate">
            {detailText}
          </span>
        ) : null}
        {row.snippet?.kind === 'range' ? (
          <span className="font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[var(--color-text-muted)] text-[11px]">
            :{row.snippet.start}–{row.snippet.end}
          </span>
        ) : null}
      </div>

      {/* Content snippet */}
      {row.snippet && row.snippet.kind !== 'range' ? (
        <div className="mt-[3px] ml-[20px] rounded-[4px] bg-[var(--color-background-secondary)] border border-[var(--color-border-subtle)] px-[8px] py-[4px] font-[ui-monospace,Menlo,monospace] text-[11px] leading-[1.55] overflow-hidden">
          {row.snippet.kind === 'diff' ? (
            <>
              <div className="text-[#e06c75] truncate">
                <span className="select-none mr-[4px] opacity-60">−</span>
                {row.snippet.minus}
              </div>
              <div className="text-[#98c379] truncate">
                <span className="select-none mr-[4px] opacity-60">+</span>
                {row.snippet.plus}
              </div>
            </>
          ) : (
            row.snippet.lines.map((line, i) => (
              <div key={i} className="text-[var(--color-text-secondary)] truncate">
                {line}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
