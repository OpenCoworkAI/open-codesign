import type { SshProfileSummary } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  title: string;
  actionLabel: string;
  pathLabel: string;
  profiles: SshProfileSummary[];
  defaultProfileId?: string;
  defaultPath?: string;
  description?: string;
  onClose: () => void;
  onConfirm: (profileId: string, path: string) => Promise<void> | void;
}

export function RemotePathModal({
  title,
  actionLabel,
  pathLabel,
  profiles,
  defaultProfileId,
  defaultPath,
  description,
  onClose,
  onConfirm,
}: Props) {
  const [profileId, setProfileId] = useState(defaultProfileId ?? profiles[0]?.id ?? '');
  const [path, setPath] = useState(defaultPath ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultPath !== undefined) setPath(defaultPath);
  }, [defaultPath]);

  async function handleConfirm() {
    if (!profileId || !path.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(profileId, path.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-[var(--color-overlay)]"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="document"
        className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-background)] shadow-[var(--shadow-elevated)] p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[var(--text-base)] font-semibold text-[var(--color-text-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {description ? (
          <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
            {description}
          </p>
        ) : null}

        {profiles.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
            还没有可用的 SSH Profile。请先到设置里的 Advanced 添加一个。
          </p>
        ) : (
          <>
            <Field label="SSH Profile">
              <select
                value={profileId}
                onChange={(e) => {
                  const next = e.target.value;
                  setProfileId(next);
                  const selected = profiles.find((profile) => profile.id === next);
                  if (!path && selected?.basePath) setPath(selected.basePath);
                }}
                className="w-full h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.username}@{profile.host}:{profile.port})
                  </option>
                ))}
              </select>
            </Field>

            <Field label={pathLabel}>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/srv/www/index.html"
                className="w-full h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              />
            </Field>
          </>
        )}

        {error ? <p className="text-[var(--text-xs)] text-[var(--color-error)]">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={profiles.length === 0 || !profileId || !path.trim() || saving}
          >
            {saving ? '处理中…' : actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="block text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] mb-1.5">
        {label}
      </p>
      {children}
    </div>
  );
}
