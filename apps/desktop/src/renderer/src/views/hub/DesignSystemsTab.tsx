import { useT } from '@open-codesign/i18n';
import { buildPreviewDocument } from '@open-codesign/runtime';
import type { LibraryDesignSystem, LibraryDesignSystemDetail } from '@open-codesign/shared';
import { Copy, Download, Plus, Upload, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ibmThumbnail from '../../assets/design-systems/ibm.png';
import stripeThumbnail from '../../assets/design-systems/stripe.png';
import vercelThumbnail from '../../assets/design-systems/vercel.png';
import { useCodesignStore } from '../../store';
import { DesignSystemDetail } from './DesignSystemDetail';
import { editLibrarySystem, groupDesignSystems } from './design-system-actions';
import './DesignSystemsTab.css';

const builtinThumbnails: Record<string, string> = {
  'builtin:ibm': ibmThumbnail,
  'builtin:vercel': vercelThumbnail,
  'builtin:stripe': stripeThumbnail,
};

export function SystemDialog({
  children,
  title,
  onClose,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="system-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="system-dialog-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="system-action"
          aria-label={t('library.close')}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function DesignSystemsTab() {
  const t = useT();
  const hubTab = useCodesignStore((s) => s.hubTab);
  const designs = useCodesignStore((s) => s.designs);
  const generating = useCodesignStore((s) => s.generationByDesign);
  const openNewDesign = useCodesignStore((s) => s.openNewDesignDialog);
  const [systems, setSystems] = useState<LibraryDesignSystem[]>([]);
  const [detail, setDetail] = useState<LibraryDesignSystemDetail | null>(null);
  const [form, setForm] = useState<'create' | 'import' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const api = typeof window === 'undefined' ? undefined : window.codesign?.designSystems;
  const refresh = useCallback(async () => {
    if (api) {
      setSystems(await api.list());
      setLoaded(true);
    }
  }, [api]);
  const work = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError('');
      try {
        await action();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    if (hubTab !== 'resources') return;
    let live = true;
    void refresh().catch((err) => {
      if (live) setError(String(err));
    });
    return () => {
      live = false;
    };
  }, [hubTab, refresh]);
  const groups = groupDesignSystems(systems);
  const running = detail?.system.sessionDesignId
    ? Boolean(generating[detail.system.sessionDesignId])
    : false;
  const preview = useMemo(() => {
    if (!detail) return '';
    try {
      return buildPreviewDocument(detail.previewSource, {
        path: 'App.jsx',
        ...(detail.system.sessionDesignId
          ? { baseHref: `workspace://${detail.system.sessionDesignId}/` }
          : {}),
      });
    } catch {
      return '';
    }
  }, [detail]);

  function show(system: LibraryDesignSystem) {
    setForm(null);
    void work(async () => {
      if (api) setDetail(await api.get(system.id));
    });
  }
  function cards(items: LibraryDesignSystem[]) {
    return (
      <div className="system-cards">
        {items.map((system) => (
          <button
            type="button"
            className="system-card"
            key={system.id}
            onClick={() => show(system)}
            disabled={busy}
          >
            <div className="system-card-art">
              {(system.thumbnail ?? builtinThumbnails[system.id]) ? (
                <img src={system.thumbnail ?? builtinThumbnails[system.id]} alt="" loading="lazy" />
              ) : (
                <span>{system.name}</span>
              )}
            </div>
            <div className="system-card-body">
              <div className="system-card-heading">
                <strong>{system.name}</strong>
                <span className="system-status">
                  {t(system.status === 'ready' ? 'library.ready' : 'library.draft')}
                </span>
              </div>
              <p>{system.description}</p>
              <small>{system.source.name}</small>
            </div>
          </button>
        ))}
      </div>
    );
  }
  function beginCreate() {
    setName('');
    setDescription('');
    setError('');
    setForm('create');
  }
  function close() {
    if (!busy) {
      setDetail(null);
      setForm(null);
      setError('');
    }
  }

  return (
    <section className={`system-library${detail ? ' has-detail' : ''}`}>
      <div hidden={Boolean(detail)}>
        <header className="system-library-header">
          <div>
            <h2>{t('library.title')}</h2>
            <p>{t('library.subtitle')}</p>
          </div>
          <div className="system-library-actions">
            <button
              type="button"
              className="system-action"
              disabled={busy}
              onClick={() => {
                setSourceId('');
                setError('');
                setForm('import');
              }}
            >
              <Upload size={16} />
              {t('library.fromDesign')}
            </button>
            <button
              type="button"
              className="system-action"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (api) {
                    const imported = await api.import();
                    if (imported) setDetail(imported);
                  }
                })
              }
            >
              {t('library.importFile')}
            </button>
            <button
              type="button"
              className="system-action primary"
              disabled={busy}
              onClick={beginCreate}
            >
              <Plus size={16} />
              {t('library.new')}
            </button>
          </div>
        </header>
        {error && !detail && !form && (
          <p role="alert" className="system-error">
            {error}
          </p>
        )}
        {!loaded && <p role="status">{t('library.loading')}</p>}
        <section className="system-group">
          <h3>{t('library.builtin')}</h3>
          {cards(groups.builtin)}
        </section>
        <section className="system-group">
          <h3>{t('library.mine')}</h3>
          {groups.personal.length ? (
            cards(groups.personal)
          ) : (
            <p className="system-empty">{t('library.empty')}</p>
          )}
        </section>
      </div>
      {detail && (
        <DesignSystemDetail
          detail={detail}
          preview={preview}
          busy={busy}
          error={error}
          onClose={close}
        >
          <button
            type="button"
            className="system-action primary"
            disabled={busy || running || detail.system.status !== 'ready'}
            onClick={() => {
              const id = detail.system.id;
              close();
              openNewDesign(id);
            }}
          >
            {t('library.use')}
          </button>
          <button
            type="button"
            className="system-action"
            disabled={busy || running}
            onClick={() =>
              void work(async () => {
                if (api) {
                  const copy = await api.fork(detail.system.id);
                  setDetail(null);
                  await editLibrarySystem(copy.system.id);
                }
              })
            }
          >
            <Copy size={16} />
            {t('library.fork')}
          </button>
          {!detail.system.builtin && (
            <button
              type="button"
              className="system-action"
              disabled={busy || running}
              onClick={() =>
                void work(async () => {
                  const id = detail.system.id;
                  setDetail(null);
                  await editLibrarySystem(id);
                })
              }
            >
              {t('library.edit')}
            </button>
          )}
          <button
            type="button"
            className="system-action"
            disabled={busy || running}
            onClick={() =>
              void work(async () => {
                if (api) setDetail(await api.validate(detail.system.id));
              })
            }
          >
            {busy
              ? t('library.checking')
              : t(detail.system.builtin ? 'library.checkPreview' : 'library.validate')}
          </button>
          <button
            type="button"
            className="system-action"
            disabled={busy || running}
            onClick={() =>
              void work(async () => {
                await api?.export(detail.system.id);
              })
            }
          >
            <Download size={16} />
            {t('library.export')}
          </button>
          {!detail.system.builtin && (
            <>
              <button
                type="button"
                className="system-action"
                disabled={busy || running}
                onClick={() => {
                  setName(detail.system.name);
                  setDescription(detail.system.description);
                  setForm('rename');
                }}
              >
                {t('library.rename')}
              </button>
              <button
                type="button"
                className="system-action"
                disabled={busy || running}
                onClick={() => setForm('delete')}
              >
                {t('library.delete')}
              </button>
            </>
          )}
        </DesignSystemDetail>
      )}
      {form && (
        <SystemDialog
          title={t(
            `library.${form === 'create' ? 'new' : form === 'import' ? 'fromDesign' : form}`,
          )}
          onClose={close}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void work(async () => {
                if (!api) return;
                if (form === 'create') {
                  const created = await api.create(name, description);
                  setForm(null);
                  await editLibrarySystem(
                    created.system.id,
                    description.trim()
                      ? `${t('library.createPrompt')}\n\n${description}`
                      : undefined,
                  );
                } else if (form === 'import') {
                  const imported = await api.import(sourceId);
                  if (imported) {
                    setForm(null);
                    setDetail(imported);
                  }
                } else if (form === 'rename' && detail) {
                  setDetail(await api.update(detail.system.id, name, description));
                  setForm(null);
                } else if (form === 'delete' && detail) {
                  await api.remove(detail.system.id);
                  setDetail(null);
                  setForm(null);
                }
              });
            }}
          >
            {(form === 'create' || form === 'rename') && (
              <>
                <label>
                  {t('library.name')}
                  <input
                    name="name"
                    required
                    maxLength={160}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  {t('library.description')}
                  <textarea
                    name="description"
                    rows={4}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            {form === 'import' && (
              <label>
                {t('library.chooseDesign')}
                <select
                  value={sourceId}
                  required
                  onChange={(e) => setSourceId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{t('library.chooseDesign')}</option>
                  {designs
                    .filter((d) => !d.designSystemId && !d.deletedAt && d.workspacePath)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {form === 'delete' && <p>{t('library.deleteHint')}</p>}
            {error && (
              <p role="alert" className="system-error">
                {error}
              </p>
            )}
            <div className="system-library-actions">
              <button type="button" className="system-action" disabled={busy} onClick={close}>
                {t('library.cancel')}
              </button>
              <button type="submit" className="system-action primary" disabled={busy}>
                {t(busy ? 'library.loading' : 'library.confirm')}
              </button>
            </div>
          </form>
        </SystemDialog>
      )}
    </section>
  );
}
