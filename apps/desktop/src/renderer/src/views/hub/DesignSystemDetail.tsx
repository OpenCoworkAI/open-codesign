import { useT } from '@open-codesign/i18n';
import type { LibraryDesignSystemDetail } from '@open-codesign/shared';
import { ArrowLeft, Check, ChevronDown, FileText, Maximize2 } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const BOARD_WIDTH = 1280;
const BOARD_HEIGHT = 900;

// The sandbox reports its bounds through messages; the parent never needs DOM access.
const measureScript = `<script>(() => {
  let last = 0;
  let scheduled = false;
  const measure = () => {
    const content = document.querySelector('[data-design-system-canvas], .ds-inner');
    let bottom = 0;
    if (content) {
      bottom = content.getBoundingClientRect().bottom + scrollY;
      for (let parent = content.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        bottom += parseFloat(getComputedStyle(parent).paddingBottom) || 0;
      }
    }
    const height = Math.ceil(content ? bottom : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, document.getElementById('root')?.scrollHeight || 0));
    if (height !== last) { last = height; parent.postMessage({ type: 'codesign:system-size', height }, '*'); }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; measure(); });
  };
  const resize = new ResizeObserver(schedule);
  const watchContent = () => {
    resize.observe(document.body);
    document.querySelectorAll('#root > *').forEach(element => resize.observe(element));
    const content = document.querySelector('[data-design-system-canvas], .ds-inner');
    if (content) resize.observe(content);
  };
  new MutationObserver(() => { watchContent(); schedule(); }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  watchContent();
  document.fonts.ready.then(schedule);
  addEventListener('load', schedule, true);
  addEventListener('transitionend', schedule, true);
  addEventListener('animationend', schedule, true);
  schedule();
})();</script>`;

function SystemPreview({ html }: { html: string }) {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [fit, setFit] = useState(true);
  const [size, setSize] = useState({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
  const [height, setHeight] = useState(BOARD_HEIGHT);
  const [measured, setMeasured] = useState(false);
  const source = useMemo(() => html.replace('</body>', `${measureScript}</body>`), [html]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({
        width: Math.max(1, element.clientWidth - 32),
        height: Math.max(1, element.clientHeight - 32),
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'codesign:system-size'
      )
        return;
      const next: unknown = event.data.height;
      if (typeof next !== 'number' || !Number.isFinite(next) || next < 100 || next > 20000) return;
      setHeight(Math.max(BOARD_HEIGHT, Math.ceil(next)));
      setMeasured(true);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  const scale = fit ? Math.min(1, size.width / BOARD_WIDTH, size.height / height) : 1;
  return (
    <section className="system-detail-preview" aria-label={t('library.preview')}>
      <header className="system-preview-header">
        <div>
          <strong>{t('library.livePreview')}</strong>
          <span>{t('library.previewHint')}</span>
        </div>
        <div className="system-preview-zoom" aria-label={t('library.previewZoom')}>
          <button type="button" aria-pressed={fit} onClick={() => setFit(true)}>
            <Maximize2 size={14} />
            {t('library.fit')}
          </button>
          <button type="button" aria-pressed={!fit} onClick={() => setFit(false)}>
            100%
          </button>
        </div>
      </header>
      <div ref={stage} className={`system-preview-stage${fit ? '' : ' is-actual-size'}`}>
        <div
          className="system-preview-surface"
          style={{ width: BOARD_WIDTH * scale, height: height * scale }}
        >
          <iframe
            ref={frame}
            title={t('library.preview')}
            sandbox="allow-scripts"
            srcDoc={source}
            data-measured-height={measured ? height : 0}
            style={{ width: BOARD_WIDTH, height, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <footer className="system-preview-footer">
        <span className="system-live-dot" />
        {t('library.interactive')}
        <span>
          {BOARD_WIDTH} × {height} · {Math.round(scale * 100)}%
        </span>
      </footer>
    </section>
  );
}

function SystemSpecification({ raw }: { raw: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState(false);
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const body = frontmatter ? raw.slice(frontmatter[0].length) : raw;
  return (
    <details className="system-spec" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <FileText size={18} />
        <strong>DESIGN.md</strong>
        <span>{t('library.specHint')}</span>
        <ChevronDown size={16} />
      </summary>
      {expanded && (
        <div className="system-spec-content">
          <div className="system-preview-zoom">
            <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>
              {t('library.readDocument')}
            </button>
            <button type="button" aria-pressed={source} onClick={() => setSource(true)}>
              {t('library.viewSource')}
            </button>
          </div>
          {source ? (
            <pre>{raw}</pre>
          ) : (
            <article className="system-spec-document">
              {frontmatter && (
                <>
                  <h3>{t('library.tokens')}</h3>
                  <pre>{frontmatter[1]}</pre>
                </>
              )}
              <ReactMarkdown
                skipHtml
                components={{
                  img: ({ alt }) => <span>{alt}</span>,
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {body}
              </ReactMarkdown>
            </article>
          )}
        </div>
      )}
    </details>
  );
}

export function DesignSystemDetail({
  detail,
  preview,
  busy,
  error,
  onClose,
  children,
}: {
  detail: LibraryDesignSystemDetail;
  preview: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const { system } = detail;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const brand = system.builtin ? system.id.split(':')[1] : undefined;
  const description = brand ? t(`library.brand.${brand}`) : system.description;
  return (
    <section className="system-detail" aria-label={system.name}>
      <header className="system-detail-header">
        <button className="system-action" type="button" disabled={busy} onClick={onClose}>
          <ArrowLeft size={16} />
          {t('library.back')}
        </button>
        <span>{t('library.details')}</span>
      </header>
      <div className="system-detail-body">
        <aside className="system-detail-sidebar">
          <div className="system-detail-identity">
            <span className="system-detail-eyebrow">
              {t(system.builtin ? 'library.builtin' : 'library.personalSource')}
            </span>
            <h2 ref={heading} tabIndex={-1}>
              {system.name}
            </h2>
            <p>{description}</p>
          </div>
          <div className={`system-detail-status${system.status === 'ready' ? ' is-ready' : ''}`}>
            <span>
              {system.status === 'ready' && <Check size={14} />}
              {t(system.status === 'ready' ? 'library.ready' : 'library.draft')}
            </span>
            <p>{t(system.status === 'ready' ? 'library.readyHint' : 'library.draftHint')}</p>
          </div>
          <div className="system-detail-actions">{children}</div>
          {error && (
            <p className="system-error" role="alert">
              {error}
            </p>
          )}
          {system.issues.length > 0 && (
            <details className="system-detail-issues">
              <summary>{t('library.checkIssues', { count: system.issues.length })}</summary>
              <p>{t('library.issuesHint')}</p>
              <ul>
                {system.issues.map((issue, index) => (
                  <li key={`${index}:${issue}`}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="system-detail-origin">
            <h3>{t('library.source')}</h3>
            <p>{system.builtin ? t('library.brandReference') : system.source.name}</p>
            {system.source.url && (
              <p className="system-origin-url">
                {system.source.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </p>
            )}
            <details>
              <summary>{t('library.attribution')}</summary>
              <p>{system.source.license ?? t('library.personalSource')}</p>
              {system.builtin && <p>{t('library.notAffiliated')}</p>}
            </details>
          </div>
        </aside>
        {preview ? (
          <SystemPreview key={`${system.id}:${detail.fingerprint}`} html={preview} />
        ) : (
          <p className="system-error">{t('library.previewError')}</p>
        )}
      </div>
      <SystemSpecification key={system.id} raw={detail.designMd} />
    </section>
  );
}
