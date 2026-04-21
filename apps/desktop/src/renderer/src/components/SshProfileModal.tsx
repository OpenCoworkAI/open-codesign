import type { OnboardingState, SshAuthMethod, SshProfileSummary } from '@open-codesign/shared';
import { Button } from '@open-codesign/ui';
import { CheckCircle, Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SaveSshProfileInput } from '../../../preload/index';

interface Props {
  existingProfiles: SshProfileSummary[];
  initial?: SshProfileSummary | null;
  onClose: () => void;
  onSaved: (next: OnboardingState) => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export function SshProfileModal({ existingProfiles, initial = null, onClose, onSaved }: Props) {
  const generatedId = useMemo(() => {
    const suffix = Date.now().toString(36).slice(-6);
    return `ssh-${suffix}`;
  }, []);
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? '');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>(initial?.authMethod ?? 'privateKey');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState(initial?.keyPath ?? '');
  const [passphrase, setPassphrase] = useState('');
  const [basePath, setBasePath] = useState(initial?.basePath ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });

  const profileId = initial?.id ?? generatedId;
  const defaultName = `${username || 'user'}@${host || 'host'}`;
  const canSave =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    (authMethod === 'password'
      ? password.trim().length > 0 || initial !== null
      : keyPath.trim().length > 0) &&
    !saving;

  function buildPayload(): SaveSshProfileInput {
    const payload: SaveSshProfileInput = {
      id: profileId,
      name: name.trim() || defaultName,
      host: host.trim(),
      port: Number(port || '22'),
      username: username.trim(),
      authMethod,
      ...(basePath.trim().length > 0 ? { basePath: basePath.trim() } : {}),
    };
    if (authMethod === 'password') {
      if (password.trim().length > 0) payload.password = password;
    } else {
      payload.keyPath = keyPath.trim();
      if (passphrase.length > 0) payload.passphrase = passphrase;
    }
    return payload;
  }

  async function handleTest() {
    if (!window.codesign?.remote) return;
    setTestState({ kind: 'testing' });
    try {
      await window.codesign.remote.testProfile(buildPayload());
      setTestState({ kind: 'ok' });
    } catch (err) {
      setTestState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleSave() {
    if (!window.codesign?.remote) return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.codesign.remote.saveProfile(buildPayload());
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const duplicateName = existingProfiles.some(
    (profile) =>
      profile.id !== profileId && profile.name.toLowerCase() === name.trim().toLowerCase(),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="SSH Profile"
      className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-[var(--color-overlay)]"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="document"
        className="w-full max-w-lg rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-background)] shadow-[var(--shadow-elevated)] p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[var(--text-base)] font-semibold text-[var(--color-text-primary)]">
            {initial ? '编辑 SSH Profile' : '添加 SSH Profile'}
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="名称">
            <TextInput value={name} onChange={setName} placeholder={defaultName} />
          </Field>
          <Field label="用户名">
            <TextInput value={username} onChange={setUsername} placeholder="root" />
          </Field>
          <Field label="主机">
            <TextInput value={host} onChange={setHost} placeholder="example.com" />
          </Field>
          <Field label="端口">
            <TextInput value={port} onChange={setPort} placeholder="22" />
          </Field>
        </div>

        <Field label="默认远程根路径（可选）">
          <TextInput value={basePath} onChange={setBasePath} placeholder="/srv/app" />
        </Field>

        <Field label="认证方式">
          <div className="flex gap-3 flex-wrap">
            {(['privateKey', 'password'] as const).map((value) => (
              <label
                key={value}
                className="inline-flex items-center gap-1.5 text-[var(--text-xs)] cursor-pointer"
              >
                <input
                  type="radio"
                  name="ssh-auth-method"
                  value={value}
                  checked={authMethod === value}
                  onChange={() => setAuthMethod(value)}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-[var(--color-text-secondary)]">
                  {value === 'privateKey' ? '私钥' : '密码'}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {authMethod === 'privateKey' ? (
          <div className="grid grid-cols-1 gap-3">
            <Field label="私钥路径">
              <TextInput
                value={keyPath}
                onChange={setKeyPath}
                placeholder="C:\\Users\\you\\.ssh\\id_rsa"
              />
            </Field>
            <Field label="私钥口令（可选）">
              <TextInput value={passphrase} onChange={setPassphrase} type="password" />
            </Field>
          </div>
        ) : (
          <Field label={`密码${initial ? '（留空则保留原值）' : ''}`}>
            <TextInput value={password} onChange={setPassword} type="password" />
          </Field>
        )}

        {duplicateName ? (
          <p className="text-[var(--text-xs)] text-[var(--color-error)]">
            已经有同名 SSH Profile，建议换一个更容易区分的名称。
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTest()}
            className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors inline-flex items-center gap-1.5"
          >
            {testState.kind === 'testing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : testState.kind === 'ok' ? (
              <CheckCircle className="w-3.5 h-3.5 text-[var(--color-success)]" />
            ) : null}
            测试连接
          </button>
          {testState.kind === 'ok' ? (
            <span className="text-[var(--text-xs)] text-[var(--color-success)]">连接成功</span>
          ) : null}
          {testState.kind === 'error' ? (
            <span className="text-[var(--text-xs)] text-[var(--color-error)] truncate">
              {testState.message}
            </span>
          ) : null}
        </div>

        {error ? <p className="text-[var(--text-xs)] text-[var(--color-error)]">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? '保存中…' : '保存'}
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

function TextInput({
  value,
  onChange,
  placeholder,
  type,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
    />
  );
}
