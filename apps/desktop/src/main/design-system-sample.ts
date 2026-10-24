import { parseDesignMd } from '@open-codesign/shared/design-md';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function json(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}
export function defaultDesignMd(name: string): string {
  return `---
version: alpha
name: ${JSON.stringify(name)}
colors:
  background: "#ffffff"
  surface: "#f4f5f7"
  text: "#202124"
  muted: "#616773"
  border: "#d8dde5"
  accent: "#28665c"
typography:
  display:
    fontFamily: system-ui
    fontSize: 40px
    fontWeight: 600
  body:
    fontFamily: system-ui
    fontSize: 16px
    lineHeight: 1.5
rounded:
  control: 8px
spacing:
  unit: 8px
components:
  primaryButton:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: 12px
---

## Overview

A clear, approachable interface. Refine this draft for the intended audience.

## Layout

Use shared spacing and a clear reading order. Keep forms and data views consistent.

## Components

Primary actions use the accent color. Preserve readable text, visible focus and disabled states.
`;
}

/** Imported documents are data. Only this fixed JSX template is executable. */
export function generateDesignSystemSample(raw: string, style = 'neutral'): string {
  let fm: Record<string, unknown> = {};
  try {
    fm = parseDesignMd(raw).frontmatter;
  } catch {
    /* Invalid imports remain repairable drafts. */
  }
  const colors = record(fm['colors']);
  const typography = record(fm['typography']);
  const body = record(typography['body']);
  const display = record(typography['display']);
  const rounded = record(fm['rounded']);
  const spacing = record(fm['spacing']);
  const components = record(fm['components']);
  const primaryKey =
    Object.keys(components).find((key) =>
      /^(primaryButton|button-primary|buttonPrimary)$/i.test(key),
    ) ?? 'primaryButton';
  const primary = record(components[primaryKey]);
  function token(value: unknown, depth = 0): unknown {
    if (depth > 6 || typeof value !== 'string') return value;
    const ref = /^\{([\w.-]+)\}$/.exec(value);
    if (!ref?.[1]) return value;
    let resolved: unknown = fm;
    for (const key of ref[1].split('.')) resolved = record(resolved)[key];
    return token(resolved, depth + 1);
  }
  const first = (map: Record<string, unknown>, keys: string[], fallback: string): string => {
    for (const key of keys) if (typeof map[key] === 'string') return map[key] as string;
    return fallback;
  };
  const data = {
    name: typeof fm['name'] === 'string' ? fm['name'] : 'Design system',
    style,
    primaryKey,
    background: first(colors, ['background'], '#ffffff'),
    surface: first(colors, ['surface'], '#f4f5f7'),
    text: first(colors, ['text'], '#202124'),
    muted: first(colors, ['muted', 'text'], '#616773'),
    border: first(colors, ['border'], '#d8dde5'),
    accent: first(colors, ['accent', 'primary'], '#28665c'),
    font: first(body, ['fontFamily'], 'system-ui'),
    displayFont: first(display, ['fontFamily'], 'system-ui'),
    radius: first(rounded, ['control', 'md', 'sm', 'none'], '8px'),
    unit:
      typeof spacing['unit'] === 'number'
        ? `${spacing['unit']}px`
        : first(spacing, ['unit', 'md'], '8px'),
    colors,
    bodySize: first(body, ['fontSize'], '16px'),
    displaySize: first(display, ['fontSize'], '48px'),
    displayWeight: typeof display['fontWeight'] === 'number' ? display['fontWeight'] : 600,
    lineHeight:
      typeof body['lineHeight'] === 'number' || typeof body['lineHeight'] === 'string'
        ? body['lineHeight']
        : 1.5,
    buttonBackground:
      token(primary['backgroundColor']) ?? first(colors, ['accent', 'primary'], '#28665c'),
    buttonText: token(primary['textColor']) ?? '#ffffff',
    buttonRadius:
      token(primary['rounded']) ?? first(rounded, ['control', 'md', 'sm', 'none'], '8px'),
    buttonPadding: token(primary['padding']) ?? '12px 20px',
  };
  const css = `*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button{cursor:pointer}
    .ds{min-height:100vh;color:var(--ds-text);background:var(--ds-bg);padding:24px;line-height:1.5}.ds-inner{max-width:1160px;margin:auto}
    .ds-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--ds-border);padding-bottom:16px;gap:24px}
    .ds nav{display:flex;gap:8px;flex-wrap:wrap}.ds nav button{border:0;background:transparent;padding:8px 12px;color:var(--ds-muted)}
    .ds nav button[aria-current=page]{color:var(--ds-accent);border-bottom:2px solid var(--ds-accent)}
    .ds-hero{padding:24px 0;max-width:820px}.ds h1{font-size:var(--ds-display-size);line-height:1.1;letter-spacing:-.025em;margin:8px 0 12px;font-weight:var(--ds-display-weight)}
    .ds p{color:var(--ds-muted);margin:8px 0}.ds-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.ds-section{border:1px solid var(--ds-border);border-radius:var(--ds-radius);padding:16px;background:var(--ds-bg)}
    .ds h2{margin:0 0 12px;font-size:18px}.ds label{display:grid;gap:4px;margin:8px 0;font-size:14px}.ds input,.ds select{width:100%;padding:8px;border:1px solid var(--ds-border);border-radius:var(--ds-radius);color:var(--ds-text);background:var(--ds-bg)}
    .ds button:focus-visible,.ds input:focus-visible,.ds select:focus-visible{outline:3px solid var(--ds-accent);outline-offset:3px}
    .ds-button{padding:var(--ds-button-padding);border:1px solid var(--ds-button-bg);border-radius:var(--ds-button-radius);background:var(--ds-button-bg);color:var(--ds-button-text);transition:opacity .15s}.ds-button:hover{opacity:.85}.ds-button:disabled{opacity:.45;cursor:default}.ds-button.secondary{background:transparent;color:var(--ds-text);border-color:var(--ds-border)}
    .ds table{width:100%;border-collapse:collapse;text-align:left}.ds td,.ds th{padding:12px 8px;border-bottom:1px solid var(--ds-border)}
    .ds-swatches{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ds-swatch{min-width:0;font-size:13px;overflow-wrap:anywhere}.ds-swatch i{display:block;height:32px;border-radius:var(--ds-radius);border:1px solid var(--ds-border);margin-bottom:4px}.ds-footer{padding:16px 0 0;color:var(--ds-muted);font-size:12px}
    .ds[data-style=ibm] .ds-section{border-radius:0;padding:16px}.ds[data-style=ibm] .ds-hero{padding:24px 0}.ds[data-style=ibm] td{padding:8px}
    .ds[data-style=vercel] .ds-header{font-family:ui-monospace,monospace}.ds[data-style=vercel] .ds-hero{max-width:700px;padding:32px 0}
    .ds[data-style=stripe] .ds-hero{background:linear-gradient(120deg,var(--ds-surface),var(--ds-bg));padding:24px;max-width:none;margin:16px 0;border-radius:var(--ds-radius)}
    @media(max-width:700px){.ds{padding:20px}.ds-grid{grid-template-columns:1fr}.ds-header{align-items:flex-start;flex-direction:column}.ds-section{padding:16px}}`;
  return `const DESIGN_SYSTEM = /*DESIGN-SYSTEM-DATA-BEGIN*/${json(data)}/*DESIGN-SYSTEM-DATA-END*/;
function App() {
  const d = DESIGN_SYSTEM;
  const [tab, setTab] = React.useState('Overview');
  const [query, setQuery] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const rows = ['Workspace foundations', 'Component guidelines', '中文排版规范'].filter(v => v.toLowerCase().includes(query.toLowerCase()));
  const tokens = {'--ds-bg':d.background,'--ds-surface':d.surface,'--ds-text':d.text,'--ds-muted':d.muted,'--ds-border':d.border,'--ds-accent':d.accent,'--ds-radius':d.radius,'--ds-unit':d.unit,'--ds-button-bg':d.buttonBackground,'--ds-button-text':d.buttonText,'--ds-button-radius':d.buttonRadius,'--ds-button-padding':d.buttonPadding,'--ds-display-size':d.displaySize,'--ds-display-weight':d.displayWeight};
  return <main className="ds" data-style={d.style} style={{...tokens,fontFamily:d.font+', system-ui, sans-serif',fontSize:d.bodySize,lineHeight:d.lineHeight}}><style>{${json(css)}}</style><div className="ds-inner" data-design-system-canvas>
    <header className="ds-header"><strong>{d.name}</strong><nav data-design-system="components.navigation" aria-label="Sample navigation">{['Overview','Components','Guidelines'].map(item=><button key={item} aria-current={tab===item?'page':undefined} onClick={()=>setTab(item)}>{item}</button>)}</nav></header>
    <section className="ds-hero" data-design-system="typography.display"><span>{tab} / 设计语言</span><h1 style={{fontFamily:d.displayFont+', system-ui, sans-serif'}}>Clear decisions.<br/>Consistent experiences.</h1><p>让每一次设计都有据可循。Typography, components and layout working together.</p></section>
    <div className="ds-grid">
    <section className="ds-section" data-design-system="colors"><h2>Color language / 语义色</h2><div className="ds-swatches">{Object.entries(d.colors).slice(0,8).map(([name,value])=><div className="ds-swatch" key={name} data-design-system={'colors.'+name}><i style={{background:String(value)}}/><small>{name}<br/>{String(value)}</small></div>)}</div></section>
    <section className="ds-section" data-design-system="typography.body"><h2>Typography / 字体层级</h2><h3 style={{fontFamily:d.displayFont+', system-ui, sans-serif',fontSize:28}}>为重要内容建立清晰层级</h3><p>A readable system makes complex information feel approachable.</p><small>辅助说明 · Labels and supporting information</small></section>
    <section className="ds-section"><h2>Controls / 组件状态</h2><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button className="ds-button" data-design-system={"components."+d.primaryKey} data-design-system-role="primary-button" onClick={()=>setSaved(v=>!v)}>{saved?'Saved / 已保存':'Save changes / 保存'}</button><button className="ds-button secondary" data-design-system="components.secondaryButton" onClick={()=>setSaved(false)}>Reset</button><button className="ds-button" disabled data-design-system={"components."+d.primaryKey} data-design-system-role="primary-button">Disabled</button></div><p role="status">{saved?'Your changes are saved. / 修改已保存。':'Try the primary action to inspect its behavior.'}</p><label data-design-system="components.input">Search guidelines / 搜索规范<input aria-label="Search guidelines" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name"/></label><label data-design-system="components.select">Density / 信息密度<select defaultValue="Comfortable"><option>Comfortable</option><option>Compact</option></select></label></section>
    <section className="ds-section" data-design-system="components.table"><h2>Workspace / 工作区</h2><div style={{overflowX:'auto'}}><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody>{rows.map(name=><tr key={name}><td>{name}</td><td>Ready / 可用</td></tr>)}</tbody></table></div>{rows.length===0&&<p>No matching guidelines.</p>}</section>
    </div><footer className="ds-footer">Design-system sample · Preview interactions use local sample data.</footer></div></main>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
`;
}

/** Refresh only derived token data; preserve agent-authored components and layout. */
export function syncDesignSystemSample(raw: string, source: string): string {
  const marker = /\/\*DESIGN-SYSTEM-DATA-BEGIN\*\/([\s\S]*?)\/\*DESIGN-SYSTEM-DATA-END\*\//;
  const existing = marker.exec(source);
  if (!existing?.[1]) return source;
  try {
    const data = record(JSON.parse(existing[1]));
    const generated = generateDesignSystemSample(
      raw,
      typeof data['style'] === 'string' ? data['style'] : 'neutral',
    );
    const next = marker.exec(generated)?.[0];
    return next ? source.replace(marker, () => next) : source;
  } catch {
    return source;
  }
}
