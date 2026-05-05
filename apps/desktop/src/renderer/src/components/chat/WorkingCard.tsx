import { useT } from '@open-codesign/i18n';
import {
  type ChatToolCallPayload,
  DEFAULT_SOURCE_ENTRY,
  getToolManifestEntry,
  TOOL_MANIFEST_V1,
  type ToolManifestIconKeyV1,
} from '@open-codesign/shared';
import {
  AlertCircle,
  Brain,
  Check,
  Eye,
  FileCheck2,
  FileEdit,
  FilePlus,
  Image,
  ListChecks,
  Loader2,
  type LucideIcon,
  MessageCircleQuestion,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  Wrench,
} from 'lucide-react';
import { useMemo } from 'react';

export interface WorkingCardProps {
  calls: ChatToolCallPayload[];
}

type ActivityStatus = 'running' | 'done' | 'error';
type ActivityKind = 'row' | 'todos';

export interface ActivityRow {
  key: string;
  Icon: LucideIcon;
  label: string;
  labelKey: string;
  detail: string | null;
  status: ActivityStatus;
  kind: ActivityKind;
  title: string;
  errorText?: string;
  durationMs?: number;
  todos?: TodoItem[];
  editCount?: number;
}

export interface TodoItem {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export function WorkingCard({ calls }: WorkingCardProps) {
  const rows = useMemo(() => buildActivityRows(calls), [calls]);
  if (rows.length === 0) return null;
  return <ActivityLedger rows={rows} />;
}

export function PreparingActivity() {
  return (
    <ActivityLedger
      rows={[
        {
          key: 'preparing-run',
          Icon: Loader2,
          label: 'Preparing run',
          labelKey: 'sidebar.chat.activity.preparingRun',
          detail: null,
          status: 'running',
          kind: 'row',
          title: 'Preparing run',
        },
      ]}
    />
  );
}

export function InlineTodoList({ call }: { call: ChatToolCallPayload }) {
  return <ActivityLedger rows={buildActivityRows([call])} />;
}

function ActivityLedger({ rows }: { rows: ActivityRow[] }) {
  const t = useT();
  const hasError = rows.some((row) => row.status === 'error');
  const hasRunning = rows.some((row) => row.status === 'running');
  const titleKey = hasError
    ? 'sidebar.chat.activity.needsAttention'
    : hasRunning
      ? 'sidebar.chat.activity.working'
      : 'sidebar.chat.activity.activity';
  const titleFallback = hasError ? 'Needs attention' : hasRunning ? 'Working' : 'Activity';
  const stepLabel =
    rows.length === 1
      ? t('sidebar.chat.activity.oneStep', { defaultValue: '1 step' })
      : t('sidebar.chat.activity.stepCount', {
          count: rows.length,
          defaultValue: `${rows.length} steps`,
        });

  return (
    <div
      className="relative w-full py-[var(--space-1)] pl-[var(--space-5)] pr-[var(--space-1)] text-[12.5px]"
      aria-live={hasRunning ? 'polite' : undefined}
    >
      <span
        className={
          hasError
            ? 'absolute left-[7px] top-[17px] bottom-[9px] w-px bg-[var(--color-error)]/45'
            : hasRunning
              ? 'absolute left-[7px] top-[17px] bottom-[9px] w-px bg-[var(--color-accent)]/45'
              : 'absolute left-[7px] top-[17px] bottom-[9px] w-px bg-[var(--color-border-muted)]'
        }
        aria-hidden
      />
      <div className="mb-[var(--space-1)] flex min-w-0 items-center gap-[var(--space-2)]">
        <span
          className={
            hasError
              ? 'h-[7px] w-[7px] rounded-full bg-[var(--color-error)]'
              : hasRunning
                ? 'h-[7px] w-[7px] rounded-full bg-[var(--color-accent)]'
                : 'h-[7px] w-[7px] rounded-full bg-[var(--color-text-muted)]'
          }
          aria-hidden
        />
        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
          {t(titleKey, { defaultValue: titleFallback })}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-[var(--color-text-muted)]">
          {stepLabel}
        </span>
      </div>
      <div className="rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-surface)_42%,transparent)] py-[var(--space-0_5)]">
        {rows.map((row) =>
          row.kind === 'todos' ? (
            <ActivityTodoBlock key={row.key} row={row} />
          ) : (
            <ActivityRowView key={row.key} row={row} />
          ),
        )}
      </div>
    </div>
  );
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function detailsOf(call: ChatToolCallPayload): Record<string, unknown> | null {
  const result = call.result;
  if (!isRecord(result)) return null;
  const details = result['details'];
  return isRecord(details) ? details : null;
}

function commandOf(call: ChatToolCallPayload): string | null {
  if (typeof call.command === 'string') return call.command;
  const details = detailsOf(call);
  return typeof details?.['command'] === 'string' ? details['command'] : null;
}

function pathOf(call: ChatToolCallPayload): string | null {
  const p = call.args?.['path'];
  if (typeof p === 'string') return p;
  const details = detailsOf(call);
  const path = details?.['path'];
  return typeof path === 'string' ? path : null;
}

function textFromToolResult(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const content = result['content'];
  if (!Array.isArray(content)) return null;
  const texts = content
    .map((item) =>
      isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string'
        ? item['text']
        : '',
    )
    .filter((text) => text.length > 0);
  return texts.length > 0 ? texts.join('\n') : null;
}

function blockedReasonOf(call: ChatToolCallPayload): string | null {
  const result = call.result;
  if (!isRecord(result)) return null;
  const details = result['details'];
  if (!isRecord(details)) return null;
  if (details['status'] === 'blocked') {
    return typeof details['reason'] === 'string' ? details['reason'] : 'blocked';
  }
  const nestedResult = details['result'];
  if (!isRecord(nestedResult)) return null;
  if (nestedResult['blocked'] === true) {
    return typeof nestedResult['reason'] === 'string' ? nestedResult['reason'] : 'blocked';
  }
  if (nestedResult['requiresView'] === true) return 'view_required';
  return null;
}

function toolErrorText(call: ChatToolCallPayload): string | undefined {
  const blocked = blockedReasonOf(call) !== null || call.status === 'error';
  return blocked
    ? (call.error?.message ?? textFromToolResult(call.result) ?? undefined)
    : undefined;
}

function nameOf(call: ChatToolCallPayload): string | null {
  const name = call.args?.['name'];
  if (typeof name === 'string') return name;
  const details = detailsOf(call);
  const detailName = details?.['name'];
  return typeof detailName === 'string' ? detailName : null;
}

const LEGACY_TOOL_NAMES = new Set([
  ...TOOL_MANIFEST_V1.tools.filter((tool) => tool.status === 'legacy').map((tool) => tool.name),
]);

const ICONS_BY_KEY: Record<ToolManifestIconKeyV1, LucideIcon> = {
  check: Check,
  eye: Eye,
  'file-edit': FileEdit,
  'file-plus': FilePlus,
  image: Image,
  'list-checks': ListChecks,
  'message-circle-question': MessageCircleQuestion,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
  type: Type,
  wrench: Wrench,
};

function durationOf(calls: ChatToolCallPayload[]): number | undefined {
  const values = calls
    .map((call) => call.durationMs)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function aggregateStatus(calls: ChatToolCallPayload[]): ActivityStatus {
  if (calls.some((call) => call.status === 'error')) return 'error';
  if (calls.some((call) => call.status === 'running')) return 'running';
  return 'done';
}

function compactList(names: string[]): string {
  if (names.length <= 3) return names.join(' · ');
  return `${names.slice(0, 3).join(' · ')} +${names.length - 3}`;
}

function detailOf(call: ChatToolCallPayload): string | null {
  const path = pathOf(call);
  if (path) return path;
  const name = nameOf(call);
  if (name) return name;
  const kind = call.args?.['kind'];
  if (typeof kind === 'string') return kind;
  const title = call.args?.['title'];
  if (typeof title === 'string') return title;
  const url = call.args?.['url'];
  if (typeof url === 'string') return url;
  if (LEGACY_TOOL_NAMES.has(call.toolName)) return call.toolName;
  return null;
}

function fileActionFor(
  call: ChatToolCallPayload,
): Pick<ActivityRow, 'Icon' | 'label' | 'labelKey'> {
  const command = commandOf(call);
  if (command === 'view') {
    return { Icon: Eye, label: 'Read file', labelKey: 'sidebar.chat.activity.readFile' };
  }
  if (command === 'create') {
    return { Icon: FilePlus, label: 'Created file', labelKey: 'sidebar.chat.activity.createdFile' };
  }
  return { Icon: FileEdit, label: 'Edited file', labelKey: 'sidebar.chat.activity.editedFile' };
}

function mergeFileRows(prev: ActivityRow, call: ChatToolCallPayload, detail: string): boolean {
  if (prev.detail !== detail || prev.status === 'error' || call.status === 'error') return false;
  const command = commandOf(call);
  const prevCreated =
    prev.labelKey === 'sidebar.chat.activity.createdFile' ||
    prev.labelKey === 'sidebar.chat.activity.createdAndEdited';
  const isMutation = command === 'create' || command === 'str_replace' || command === 'insert';
  if (!isMutation && command !== null) return false;
  prev.editCount = (prev.editCount ?? 1) + 1;
  prev.status = call.status;
  if ((prevCreated && command !== 'create') || (!prevCreated && command === 'create')) {
    prev.Icon = FileCheck2;
    prev.label = 'Created and edited';
    prev.labelKey = 'sidebar.chat.activity.createdAndEdited';
  }
  if (call.durationMs !== undefined) prev.durationMs = call.durationMs;
  prev.title = `${prev.label}: ${detail}`;
  return true;
}

function pushSkillAggregate(rows: ActivityRow[], calls: ChatToolCallPayload[], startIndex: number) {
  const names = calls
    .map((call) => nameOf(call))
    .filter((name): name is string => name !== null && name.length > 0);
  const detail = names.length > 0 ? compactList(names) : null;
  const allNames = names.length > 0 ? names.join(', ') : 'skill';
  const status = aggregateStatus(calls);
  const errorText =
    status === 'error'
      ? calls.map((call) => toolErrorText(call)).find((text) => text !== undefined)
      : undefined;
  const durationMs = durationOf(calls);
  rows.push({
    key: `skill-${startIndex}`,
    Icon: Sparkles,
    label: status === 'running' ? 'Loading design rules' : 'Loaded design rules',
    labelKey:
      status === 'running'
        ? 'sidebar.chat.activity.loadingDesignRules'
        : 'sidebar.chat.activity.loadedDesignRules',
    detail,
    status,
    kind: 'row',
    title: `${status === 'running' ? 'Loading' : 'Loaded'} design rules: ${allNames}`,
    ...(errorText !== undefined ? { errorText } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
}

function pushTodoRow(rows: ActivityRow[], call: ChatToolCallPayload, index: number) {
  const todos = extractTodos(call);
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const total = todos.length;
  rows.push({
    key: `todos-${index}`,
    Icon: ListChecks,
    label: 'Plan progress',
    labelKey: 'sidebar.chat.activity.planProgress',
    detail: total > 0 ? `${done}/${total}` : null,
    status: call.status,
    kind: 'todos',
    title: total > 0 ? `Plan progress: ${done}/${total}` : 'Plan progress',
    todos,
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  });
}

function pushGenericToolRow(rows: ActivityRow[], call: ChatToolCallPayload, index: number) {
  const manifestEntry = getToolManifestEntry(call.toolName);
  const Icon = manifestEntry ? ICONS_BY_KEY[manifestEntry.iconKey] : Wrench;
  const label = LEGACY_TOOL_NAMES.has(call.toolName)
    ? 'Legacy tool'
    : (manifestEntry?.label ?? call.toolName);
  const detail = detailOf(call);
  const errorText = toolErrorText(call);
  rows.push({
    key: `c-${index}`,
    Icon,
    label,
    labelKey: LEGACY_TOOL_NAMES.has(call.toolName)
      ? 'sidebar.chat.activity.legacyTool'
      : 'sidebar.chat.activity.genericTool',
    detail,
    status: call.status,
    kind: 'row',
    title: detail ? `${call.toolName}: ${detail}` : call.toolName,
    ...(errorText !== undefined ? { errorText } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  });
}

export function buildActivityRows(calls: ChatToolCallPayload[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  let lastFileRowIdx = -1;
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i];
    if (!call) continue;

    if (call.toolName === 'skill') {
      const skillCalls: ChatToolCallPayload[] = [call];
      let end = i + 1;
      while (end < calls.length && calls[end]?.toolName === 'skill') {
        const next = calls[end];
        if (next) skillCalls.push(next);
        end += 1;
      }
      pushSkillAggregate(rows, skillCalls, i);
      i = end - 1;
      lastFileRowIdx = -1;
      continue;
    }

    if (call.toolName === 'set_todos') {
      pushTodoRow(rows, call, i);
      continue;
    }

    if (call.toolName === 'set_title' && call.status !== 'error') continue;
    if (call.toolName === 'done' && call.status !== 'error') continue;

    if (call.toolName === 'set_title') {
      const errorText = toolErrorText(call);
      rows.push({
        key: `title-${i}`,
        Icon: Type,
        label: 'Title update failed',
        labelKey: 'sidebar.chat.activity.titleUpdateFailed',
        detail: detailOf(call),
        status: 'error',
        kind: 'row',
        title: 'set_title failed',
        ...(errorText !== undefined ? { errorText } : {}),
      });
      continue;
    }

    if (call.toolName === 'done') {
      const errorText = toolErrorText(call);
      rows.push({
        key: `done-${i}`,
        Icon: AlertCircle,
        label: 'Final check failed',
        labelKey: 'sidebar.chat.activity.finalCheckFailed',
        detail: pathOf(call) ?? DEFAULT_SOURCE_ENTRY,
        status: 'error',
        kind: 'row',
        title: 'done failed',
        ...(errorText !== undefined ? { errorText } : {}),
      });
      continue;
    }

    if (call.toolName === 'inspect_workspace') {
      const errorText = toolErrorText(call);
      rows.push({
        key: `inspect-${i}`,
        Icon: Search,
        label:
          call.status === 'running'
            ? 'Checking workspace'
            : call.status === 'error'
              ? 'Workspace check failed'
              : 'Checked workspace',
        labelKey:
          call.status === 'running'
            ? 'sidebar.chat.activity.checkingWorkspace'
            : call.status === 'error'
              ? 'sidebar.chat.activity.workspaceCheckFailed'
              : 'sidebar.chat.activity.checkedWorkspace',
        detail: null,
        status: call.status,
        kind: 'row',
        title: 'inspect_workspace',
        ...(errorText !== undefined ? { errorText } : {}),
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
      });
      lastFileRowIdx = -1;
      continue;
    }

    if (call.toolName === 'str_replace_based_edit_tool') {
      const detail = pathOf(call);
      const errorText = toolErrorText(call);
      const { Icon, label, labelKey } = fileActionFor(call);
      if (detail && errorText === undefined && lastFileRowIdx >= 0) {
        const prev = rows[lastFileRowIdx];
        if (prev && mergeFileRows(prev, call, detail)) continue;
      }
      rows.push({
        key: `file-${i}`,
        Icon,
        label,
        labelKey,
        detail,
        status: call.status,
        kind: 'row',
        title: detail ? `${label}: ${detail}` : label,
        ...(errorText !== undefined ? { errorText } : {}),
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
      });
      lastFileRowIdx = rows.length - 1;
      continue;
    }

    if (call.toolName === 'preview') {
      const detail = pathOf(call) ?? DEFAULT_SOURCE_ENTRY;
      const errorText = toolErrorText(call);
      rows.push({
        key: `preview-${i}`,
        Icon: Eye,
        label:
          call.status === 'running'
            ? 'Previewing'
            : call.status === 'error'
              ? 'Preview failed'
              : 'Previewed',
        labelKey:
          call.status === 'running'
            ? 'sidebar.chat.activity.previewing'
            : call.status === 'error'
              ? 'sidebar.chat.activity.previewFailed'
              : 'sidebar.chat.activity.previewed',
        detail,
        status: call.status,
        kind: 'row',
        title: `preview: ${detail}`,
        ...(errorText !== undefined ? { errorText } : {}),
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
      });
      lastFileRowIdx = -1;
      continue;
    }

    if (call.toolName === 'workspace_memory') {
      const command = commandOf(call);
      const detail = pathOf(call) ?? 'MEMORY.md';
      const errorText = toolErrorText(call);
      rows.push({
        key: `memory-${i}`,
        Icon: Brain,
        label:
          call.status === 'running'
            ? 'Updating memory'
            : command === 'create'
              ? 'Created memory'
              : 'Updated memory',
        labelKey:
          call.status === 'running'
            ? 'sidebar.chat.activity.updatingMemory'
            : command === 'create'
              ? 'sidebar.chat.activity.createdMemory'
              : 'sidebar.chat.activity.updatedMemory',
        detail,
        status: call.status,
        kind: 'row',
        title: `${call.toolName}: ${detail}`,
        ...(errorText !== undefined ? { errorText } : {}),
        ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
      });
      lastFileRowIdx = -1;
      continue;
    }

    pushGenericToolRow(rows, call, i);
    lastFileRowIdx = -1;
  }
  return rows;
}

export const buildRows = buildActivityRows;

function ActivityTodoBlock({ row }: { row: ActivityRow }) {
  const t = useT();
  const todos = row.todos ?? [];
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="px-[var(--space-1)] py-[var(--space-1_5)]" title={row.title}>
      <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-[var(--space-2)]">
        <ActivityIcon row={row} />
        <div className="min-w-0">
          <span className="font-medium text-[var(--color-text-secondary)]">
            {t(row.labelKey, { defaultValue: row.label })}
          </span>
        </div>
        {row.detail ? (
          <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
            {row.detail}
          </span>
        ) : null}
      </div>
      <div className="mt-[var(--space-1)] pl-[calc(20px+var(--space-2))]">
        <div className="mb-[var(--space-1)] h-[3px] overflow-hidden rounded-full bg-[var(--color-background-secondary)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="space-y-[2px]">
          {todos.map((todo, index) => (
            <div
              key={`${index}-${todo.text.slice(0, 16)}`}
              className="grid grid-cols-[14px_minmax(0,1fr)] gap-[var(--space-2)] text-[12px] leading-[1.4]"
            >
              {todo.status === 'completed' ? (
                <span className="mt-[2px] inline-flex h-[13px] w-[13px] items-center justify-center rounded-[3px] bg-[var(--color-accent)] text-white">
                  <Check className="h-[9px] w-[9px]" strokeWidth={3} />
                </span>
              ) : todo.status === 'in_progress' ? (
                <span className="mt-[2px] inline-flex h-[13px] w-[13px] rounded-[3px] border border-[var(--color-accent)] bg-[var(--color-accent)]/10" />
              ) : (
                <span className="mt-[2px] inline-flex h-[13px] w-[13px] rounded-[3px] border border-[var(--color-border-muted)] bg-[var(--color-surface)]/40" />
              )}
              <span
                className={
                  todo.status === 'completed'
                    ? 'truncate text-[var(--color-text-muted)] line-through'
                    : todo.status === 'in_progress'
                      ? 'truncate font-medium text-[var(--color-text-primary)]'
                      : 'truncate text-[var(--color-text-secondary)]'
                }
              >
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityRowView({ row }: { row: ActivityRow }) {
  const t = useT();
  const detailText =
    row.detail && row.editCount && row.editCount > 1
      ? `${row.detail} (${row.editCount} edits)`
      : row.detail;
  const durationText =
    row.durationMs !== undefined && row.durationMs >= 1000
      ? `${(row.durationMs / 1000).toFixed(row.durationMs >= 10_000 ? 0 : 1)}s`
      : null;

  return (
    <div
      className={
        row.status === 'error'
          ? 'px-[var(--space-1)] py-[var(--space-1_5)] text-[var(--color-error)]'
          : 'px-[var(--space-1)] py-[var(--space-1_5)] text-[var(--color-text-secondary)]'
      }
      title={row.title}
    >
      <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-[var(--space-2)]">
        <ActivityIcon row={row} />
        <div className="flex min-w-0 items-baseline gap-[var(--space-2)]">
          <span
            className={
              row.status === 'error'
                ? 'shrink-0 font-medium text-[var(--color-error)]'
                : 'shrink-0 font-medium text-[var(--color-text-secondary)]'
            }
          >
            {t(row.labelKey, { defaultValue: row.label })}
          </span>
          {detailText ? (
            <span className="min-w-0 truncate font-[var(--font-mono),ui-monospace,Menlo,monospace] text-[var(--color-text-primary)]">
              {detailText}
            </span>
          ) : null}
        </div>
        {durationText ? (
          <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">
            {durationText}
          </span>
        ) : null}
      </div>
      {row.errorText ? (
        <div className="mt-[var(--space-1)] pl-[calc(20px+var(--space-2))] text-[11px] leading-[1.35] text-[var(--color-error)] break-words">
          {row.errorText}
        </div>
      ) : null}
    </div>
  );
}

function ActivityIcon({ row }: { row: ActivityRow }) {
  const { Icon } = row;
  const base =
    'inline-flex h-[20px] w-[20px] items-center justify-center rounded-[var(--radius-sm)]';
  if (row.status === 'running') {
    return (
      <span
        className={`${base} bg-[var(--color-accent-tint)] text-[var(--color-accent)]`}
        aria-hidden
      >
        <Loader2 className="h-[12px] w-[12px] animate-spin" />
      </span>
    );
  }
  if (row.status === 'error') {
    return (
      <span className={`${base} bg-[var(--color-error)]/10 text-[var(--color-error)]`} aria-hidden>
        <AlertCircle className="h-[12px] w-[12px]" />
      </span>
    );
  }
  return (
    <span
      className={`${base} bg-[var(--color-background-secondary)] text-[var(--color-text-muted)]`}
      aria-hidden
    >
      <Icon className="h-[12px] w-[12px]" />
    </span>
  );
}
