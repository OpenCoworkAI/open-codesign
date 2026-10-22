import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extract } from 'zip-lib';
import { jpeg } from '../fixtures/native-image';
import { findSystemChrome } from './chrome-discovery';
import { exportPptx } from './pptx';
import { renderNativeSlides } from './pptx-native';

const chromePath = await findSystemChrome().catch(() => undefined);
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const options = {
  ...(chromePath ? { chromePath } : {}),
  injectTailwind: false,
  renderTimeoutMs: 15_000,
};
const html = (body: string, css = '') => `<!doctype html><html><head><style>
  * { box-sizing: border-box; } body { margin:0; }
  .slide { width:1280px;height:720px;background:#fff;position:relative;padding:48px; }
  h1 { font: bold 48px/1.2 Arial; margin:0 0 24px; }
  p { font:24px/1.4 Arial; margin:0; }
  ${css}
</style></head><body>${body}</body></html>`;

describe.skipIf(!chromePath)('native PPTX in system Chromium', () => {
  let directory: string;
  const qaDirectory = process.env['CODESIGN_PPTX_QA_DIR'];
  beforeAll(async () => {
    directory = qaDirectory ?? (await mkdtemp(join(tmpdir(), 'pptx-native-browser-')));
    if (qaDirectory) await mkdir(directory, { recursive: true });
  });
  afterAll(async () => {
    if (!qaDirectory) await rm(directory, { recursive: true, force: true });
  });

  it('exports every numbered page when navigation mounts only the current slide', async () => {
    const source = html(`<main id="stage"></main><nav aria-label="页面切换">
      <button aria-label="第 1 页 封面" onclick="show(1)">1</button>
      <button aria-label="第 2 页 图表" onclick="show(2)">2</button>
      <button aria-label="第 3 页 结论" onclick="show(3)">3</button></nav>
      <script>function show(n) {
        document.getElementById('stage').innerHTML = '<section class="slide" id="p'+n+'"><h1>页面 '+n+'</h1></section>';
        if(n===2) { const chart=document.createElement('div'); chart.style='width:600px;height:300px';
          chart.setAttribute('data-pptx-chart',JSON.stringify({type:'bar',labels:['Q1','Q2'],series:[{name:'收入',values:[120,150]}]}));
          document.querySelector('.slide').appendChild(chart); }
        document.querySelectorAll('nav button').forEach((b,i)=>b.setAttribute('aria-current',i===n-1?'true':'false'));
      } show(2);</script>`);
    const models = await renderNativeSlides(source, options);
    expect(models).toHaveLength(3);
    expect(
      models.map((model) =>
        model.elements
          .filter((el) => el.type === 'text')
          .flatMap((el) => el.runs.map((run) => run.text))
          .join(''),
      ),
    ).toEqual(['页面 1', '页面 2', '页面 3']);
    expect(
      models.map((model) => model.elements.filter((el) => el.type === 'chart').length),
    ).toEqual([0, 1, 0]);
  }, 30_000);

  it('distinguishes dynamically mounted charts with the same visible text', async () => {
    const models = await renderNativeSlides(
      html(`<main id="stage"></main><nav>
      <button aria-label="Page 1" onclick="show(1)">1</button>
      <button aria-label="Page 2" onclick="show(2)">2</button></nav>
      <script>function show(n) {
        document.getElementById('stage').innerHTML = '<section class="slide"><h1>收入</h1><div style="width:400px;height:240px"></div></section>';
        document.querySelector('.slide div').setAttribute('data-pptx-chart', JSON.stringify({type:'bar',labels:['Q1'],series:[{name:'收入',values:[n*100]}]}));
      } show(1);</script>`),
      options,
    );
    expect(
      models.map((model) => model.elements.find((el) => el.type === 'chart')?.series[0]?.values),
    ).toEqual([[100], [200]]);
  }, 30_000);

  it('distinguishes dynamic pages styled only by the slide root class', async () => {
    const models = await renderNativeSlides(
      html(
        `<main id="stage"></main><nav>
      <button aria-label="Page 1" onclick="show(1)">1</button>
      <button aria-label="Page 2" onclick="show(2)">2</button></nav>
      <script>function show(n) {
        document.getElementById('stage').innerHTML = '<section class="slide theme-'+n+'"><h1>收入</h1></section>';
      } show(1);</script>`,
        '.theme-1{background:#112233}.theme-2{background:#445566}',
      ),
      options,
    );
    expect(
      models.map((model) => model.elements.find((el) => el.type === 'shape')?.fill.hex),
    ).toEqual(['112233', '445566']);
  }, 30_000);

  it('preserves explicit chart styling and suppressed CSS list markers', async () => {
    const data = JSON.stringify({
      type: 'pie',
      labels: ['直销', '伙伴'],
      series: [{ name: '占比', values: [60, 40] }],
      colors: ['#19354a', '#9badb8'],
      showLegend: false,
      showValue: true,
      holeSize: 50,
    });
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><ul style="list-style:none"><li>自定义标记</li></ul><div data-pptx-chart='${data}' style="width:400px;height:280px"></div></section>`,
      ),
      options,
    );
    expect(models[0]?.elements.find((el) => el.type === 'chart')).toMatchObject({
      colors: ['19354A', '9BADB8'],
      showLegend: false,
      showValue: true,
      holeSize: 50,
    });
    expect(models[0]?.elements.find((el) => el.type === 'text')).not.toHaveProperty('list');
  }, 30_000);

  it.each([
    ['JPG', jpeg.replace('image/jpeg', 'image/jpg'), 'jpeg'],
    ['JPEG', jpeg.replace('image/jpeg', 'image/JPEG'), 'jpeg'],
    ['PNG', `data:image/PNG;base64,${png}`, 'png'],
  ])(
    'exports %s data URLs as independent images alongside editable text',
    async (name, data, extension) => {
      const destination = join(directory, `mime-${name}.pptx`);
      const result = await exportPptx(
        html(
          `<section class="slide"><p>Editable foreground</p><img src="${data}" style="width:96px;height:96px" /></section>`,
        ),
        destination,
        { ...options, sourcePath: 'deck.html', renderMode: 'native' },
      );
      expect(result.warnings?.some((warning) => warning.includes('rasterized')) ?? false).toBe(
        false,
      );
      const unpacked = join(directory, `mime-${name}-unpacked`);
      await extract(destination, unpacked);
      const parser = new DOMParser();
      const slide = parser.parseFromString(
        await readFile(join(unpacked, 'ppt/slides/slide1.xml'), 'utf8'),
        'application/xml',
      );
      expect(slide.getElementsByTagName('p:pic')).toHaveLength(1);
      expect(slide.getElementsByTagName('a:t')[0]?.textContent).toBe('Editable foreground');
      const rels = parser.parseFromString(
        await readFile(join(unpacked, 'ppt/slides/_rels/slide1.xml.rels'), 'utf8'),
        'application/xml',
      );
      const imageRel = Array.from(rels.getElementsByTagName('Relationship')).find((entry) =>
        entry.getAttribute('Type')?.endsWith('/image'),
      );
      const target = imageRel?.getAttribute('Target') ?? '';
      expect(posix.extname(target)).toBe(`.${extension}`);
      expect(await readFile(join(unpacked, 'ppt/slides', target))).toEqual(
        Buffer.from(data?.split(',')[1] ?? '', 'base64'),
      );
    },
    30_000,
  );

  it('extracts grid cards, CJK rich text, shapes and independent local images', async () => {
    await writeFile(join(directory, 'sample.png'), Buffer.from(png, 'base64'));
    const source = html(
      `<section class="slide"><h1>季度报告</h1>
      <div class="cards"><div class="card"><p>收入 <strong>增长 32%</strong></p></div><div class="card"><p>客户 120 家</p></div></div>
      <div class="circle"></div><div class="line"></div><img src="sample.png" style="width:96px;height:96px" />
    </section>`,
      `.cards{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card{padding:20px;background:#e2e8f0;border-radius:12px}.circle{width:48px;height:48px;border-radius:50%;background:#123456}.line{width:240px;height:2px;background:#334455}`,
    );
    const models = await renderNativeSlides(source, {
      ...options,
      sourcePath: 'deck.html',
      assetBasePath: directory,
      assetRootPath: directory,
    });
    expect(models).toHaveLength(1);
    const model = models[0];
    expect(model?.warnings.some((warning) => warning.includes('rasterized'))).toBe(false);
    const texts = model?.elements.filter((el) => el.type === 'text') ?? [];
    expect(texts.flatMap((el) => el.runs.map((run) => run.text)).join('')).toBe(
      '季度报告收入 增长 32%客户 120 家',
    );
    expect(texts[1]?.runs.some((run) => run.bold && run.text === '增长 32%')).toBe(true);
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(1);
    expect(model?.elements.some((el) => el.type === 'shape' && el.shape === 'ellipse')).toBe(true);
    expect(texts[2]?.x).toBeGreaterThan(texts[1]?.x ?? 0);
    expect(texts[2]?.y).toBe(texts[1]?.y);
  }, 30_000);

  it('keeps unmarked SVG bars, grid lines and labels editable at viewBox scale', async () => {
    const models = await renderNativeSlides(
      html(`<section class="slide"><svg role="img" width="520" height="200" viewBox="0 0 1040 400" data-research-values="2023:949.5万辆;2024:1286.6万辆;2025:1649万辆">
      <line x1="68" x2="1010" y1="334" y2="334" stroke="#ccd4de" />
      <g><rect x="160" y="190" width="130" height="144" rx="6" fill="#d5e9dc" /><text x="225" y="175" text-anchor="middle" style="font:700 24px Arial;fill:#123456">949.5</text><text x="225" y="365" text-anchor="middle">2023 年</text></g>
      <g><rect x="475" y="139" width="130" height="195" rx="6" fill="#98c5a3" /><text x="540" y="123" text-anchor="middle" style="font:700 24px Arial;fill:#123456">1286.6</text></g>
      <g><rect x="790" y="85" width="130" height="249" rx="6" fill="#1d8732" /><text x="855" y="69" text-anchor="middle" style="font:700 24px Arial;fill:#123456">1649</text></g>
    </svg></section>`),
      options,
    );
    const model = models[0];
    expect(model?.elements.filter((element) => element.type === 'image')).toHaveLength(0);
    expect(
      model?.elements.filter(
        (element) => element.type === 'shape' && element.shape === 'roundRect',
      ),
    ).toHaveLength(3);
    expect(model?.elements.filter((element) => element.type === 'line')).toHaveLength(1);
    const texts = model?.elements.filter((element) => element.type === 'text') ?? [];
    expect(texts.map((element) => element.runs.map((run) => run.text).join(''))).toEqual([
      '949.5',
      '2023 年',
      '1286.6',
      '1649',
    ]);
    expect(texts[0]?.runs[0]).toMatchObject({ fontSize: 12, color: { hex: '123456', opacity: 1 } });
    expect(model?.warnings.join(' ')).toContain('data series');
  }, 30_000);

  it('keeps horizontal SVG bars and their dashed threshold line editable', async () => {
    const models = await renderNativeSlides(
      html(`<section class="slide"><svg role="img" width="620" height="268" viewBox="0 0 620 268">
      <line x1="78" x2="78" y1="26" y2="212" stroke="#ccd4de" />
      <rect x="78" y="36" width="237" height="40" rx="5" fill="#d5e9dc" />
      <text x="62" y="62" text-anchor="end">2023 年</text><text x="327" y="63">31.6%</text>
      <line x1="453" x2="453" y1="26" y2="236" stroke="#778899" stroke-width="1.5" stroke-dasharray="5 5" />
      <text x="453" y="20" text-anchor="middle">50%</text>
    </svg></section>`),
      options,
    );
    const model = models[0];
    expect(model?.elements.filter((element) => element.type === 'image')).toHaveLength(0);
    expect(model?.elements.filter((element) => element.type === 'line')).toHaveLength(2);
    expect(
      model?.elements.find((element) => element.type === 'line' && element.dash === 'dash'),
    ).toMatchObject({ width: 0, height: 210, strokeWidth: 1.5 });
    expect(
      model?.elements
        .filter((element) => element.type === 'text')
        .flatMap((element) => element.runs.map((run) => run.text)),
    ).toEqual(['2023 年', '31.6%', '50%']);
  }, 30_000);

  it('reads horizontal native chart direction from chart metadata', async () => {
    const data = JSON.stringify({
      type: 'bar',
      barDirection: 'horizontal',
      labels: ['2023', '2024'],
      series: [{ name: '占比', values: [31.6, 40.9] }],
    });
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><svg width="620" height="268" data-pptx-chart='${data}'></svg></section>`,
      ),
      options,
    );
    expect(models[0]?.elements.find((element) => element.type === 'chart')).toMatchObject({
      barDirection: 'horizontal',
    });
  }, 30_000);

  it.each([
    ['path', '<path d="M0 50 C20 0 60 0 90 50" stroke="green" fill="none" />', ''],
    ['clip', '<g clip-path="inset(4px)"><rect width="100" height="60" fill="green" /></g>', ''],
    ['background', '', 'background:#eeeeee'],
  ])(
    'locally rasterizes an unsupported SVG %s without duplicating its labels',
    async (_name, extra, style) => {
      const models = await renderNativeSlides(
        html(
          `<section class="slide"><p>保留文本</p><svg width="240" height="140" style="${style}"><rect x="10" y="10" width="80" height="100" fill="green" /><text x="20" y="40">图内标签</text>${extra}</svg></section>`,
        ),
        options,
      );
      expect(models[0]?.elements.filter((element) => element.type === 'image')).toHaveLength(1);
      expect(
        models[0]?.elements
          .filter((element) => element.type === 'text')
          .flatMap((element) => element.runs.map((run) => run.text)),
      ).toEqual(['保留文本']);
    },
    30_000,
  );

  it('keeps nested list items as editable native bullets and numbers exactly once', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><ul><li>第一项 <strong>重点</strong><ol start="3"><li>子项</li></ol></li><li>第二项</li></ul></section>',
      ),
      options,
    );
    const model = models[0];
    const texts = model?.elements.filter((element) => element.type === 'text') ?? [];
    expect(
      texts
        .flatMap((element) => element.runs.map((run) => run.text))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe('第一项 重点 子项 第二项');
    expect(texts.map((element) => element.list)).toEqual([
      { kind: 'bullet', level: 0 },
      { kind: 'number', level: 1, start: 3 },
      { kind: 'bullet', level: 0 },
    ]);
    expect(model?.warnings.some((warning) => warning.includes('list marker'))).toBe(false);
  }, 30_000);

  it('extracts a regular HTML table as one native table, not an image', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><table style="width:480px;border-collapse:collapse"><tr><th>指标</th><th>数值</th></tr><tr><td>收入</td><td>42</td></tr></table></section>',
      ),
      options,
    );
    const table = models[0]?.elements.find((element) => element.type === 'table');
    expect(table?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ['指标', '数值'],
      ['收入', '42'],
    ]);
    expect(models[0]?.elements.filter((element) => element.type === 'image')).toHaveLength(0);
  }, 30_000);

  it('preserves uniform cell borders and locally rasterizes a decorated table', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><p>可编辑标题</p><table style="width:320px"><tr><td style="border:2px solid #123456;background:#eeeeee;text-align:right">边框单元格</td></tr></table><table style="width:320px"><tr><td style="background:linear-gradient(red,blue)">复杂表格</td></tr></table><p>可编辑说明</p></section>',
      ),
      options,
    );
    const model = models[0];
    const table = model?.elements.find((element) => element.type === 'table');
    expect(table?.rows[0]?.[0]).toMatchObject({
      border: { width: 2, color: { hex: '123456', opacity: 1 } },
    });
    expect(model?.elements.filter((element) => element.type === 'table')).toHaveLength(1);
    expect(model?.elements.filter((element) => element.type === 'image')).toHaveLength(1);
    expect(
      model?.elements
        .filter((element) => element.type === 'text')
        .flatMap((element) => element.runs.map((run) => run.text)),
    ).toEqual(['可编辑标题', '可编辑说明']);
    expect(model?.warnings.join(' ')).toContain('complex table cell decoration');
  }, 30_000);

  it('keeps ordinary header and bottom-rule table borders native', async () => {
    const models = await renderNativeSlides(
      html(`<section class="slide"><table style="border-collapse:collapse;width:480px">
      <tr><th style="border-top:2px solid #123456;border-bottom:1px solid #ccddee">季度</th><th>收入</th></tr>
      <tr><td>Q1</td><td style="border-bottom:1px solid #ccddee">120</td></tr></table></section>`),
      options,
    );
    const table = models[0]?.elements.find((el) => el.type === 'table');
    expect(table?.rows[0]?.[0]?.borders?.map((border) => border.width)).toEqual([2, 0, 1, 0]);
    expect(table?.rows[1]?.[1]?.borders?.[2]?.color.hex).toBe('CCDDEE');
    expect(models[0]?.elements.filter((el) => el.type === 'image')).toHaveLength(0);
  }, 30_000);

  it('exports transparent zero-width table edges and rasterizes rounded cells', async () => {
    const source = html(`<section class="slide">
      <table><tr><td style="border:0 solid transparent;border-bottom:1px solid #123456">原生边框</td></tr></table>
      <table><tr><td style="border-top:2px solid #123456;border-radius:12px">圆角单元格</td></tr></table>
    </section>`);
    const result = await exportPptx(source, join(directory, 'table-edge-regression.pptx'), {
      ...options,
      renderMode: 'native',
    });
    expect(result.path).toBeTruthy();
    const models = await renderNativeSlides(source, options);
    expect(models[0]?.elements.filter((el) => el.type === 'table')).toHaveLength(1);
    expect(models[0]?.elements.filter((el) => el.type === 'image')).toHaveLength(1);
    expect(models[0]?.warnings.join(' ')).toContain('complex table cell decoration');
  }, 30_000);

  it('preserves centered cover image cropping as an editable picture', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><img src="data:image/png;base64,${png}" style="width:120px;height:80px;object-fit:cover" /></section>`,
      ),
      options,
    );
    const images = models[0]?.elements.filter((element) => element.type === 'image') ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ fit: 'cover' });
    expect(models[0]?.warnings.some((warning) => warning.includes('rasterized'))).toBe(false);
  }, 30_000);

  it('keeps rectangular inset-clipped pictures editable', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><img src="data:image/png;base64,${png}" style="width:120px;height:80px;clip-path:inset(10px 20px 15px 25px)" /></section>`,
      ),
      options,
    );
    const images = models[0]?.elements.filter((element) => element.type === 'image') ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ crop: { top: 10, right: 20, bottom: 15, left: 25 } });
    expect(models[0]?.warnings.some((warning) => warning.includes('rasterized'))).toBe(false);
  }, 30_000);

  it('preserves translated layered cards as independent editable objects', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><div style="position:absolute;left:80px;top:90px;width:260px;height:100px;background:#eeeeee;transform:translate(25px,15px)"><p>移位卡片</p></div><p style="position:absolute;left:120px;top:120px;z-index:2">前景文字</p></section>',
      ),
      options,
    );
    const model = models[0];
    expect(
      model?.elements
        .filter((element) => element.type === 'text')
        .flatMap((element) => element.runs.map((run) => run.text)),
    ).toEqual(['移位卡片', '前景文字']);
    expect(model?.elements.filter((element) => element.type === 'image')).toHaveLength(0);
    expect(model?.warnings.some((warning) => warning.includes('CSS transform'))).toBe(false);
  }, 30_000);

  it('reads explicit chart data into a native chart without duplicating SVG labels', async () => {
    const data = JSON.stringify({
      type: 'line',
      labels: ['一月', '二月'],
      series: [{ name: '收入', values: [12, 18] }],
    });
    const source = html(
      `<section class="slide"><div data-pptx-chart='${data}' style="width:400px;height:240px"><svg width="400" height="240"><text x="10" y="20">视觉标签</text></svg></div></section>`,
    );
    const models = await renderNativeSlides(source, options);
    const chart = models[0]?.elements.find((element) => element.type === 'chart');
    expect(chart).toMatchObject({
      chartType: 'line',
      labels: ['一月', '二月'],
      series: [{ name: '收入', values: [12, 18] }],
    });
    expect(models[0]?.elements.filter((element) => element.type === 'text')).toHaveLength(0);
    expect(models[0]?.elements.filter((element) => element.type === 'image')).toHaveLength(0);
    await expect(
      renderNativeSlides(
        html(
          '<section class="slide"><div data-pptx-chart="{bad}" style="width:400px;height:240px"></div></section>',
        ),
        options,
      ),
    ).rejects.toThrow('data-pptx-chart');
  }, 30_000);

  it('exports a four-page quality fixture with editable text, table and all chart types', async () => {
    const marker = (type: 'bar' | 'line' | 'pie', values: number[]) =>
      JSON.stringify({
        type,
        labels: ['甲', '乙', '丙'],
        series: [{ name: `${type}系列`, values }],
      });
    const bars = [4, 6, 9]
      .map(
        (value, index) =>
          `<rect x="${60 + index * 105}" y="${205 - value * 17}" width="45" height="${value * 17}" fill="#c0504d" />`,
      )
      .join('');
    const line = [5, 7, 8]
      .map((value, index) => `${82 + index * 105},${205 - value * 17}`)
      .join(' ');
    const source = html(`
      <section class="slide"><h1>中文季度报告</h1><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px"><div style="background:#eeeeee;padding:20px"><p>收入 <strong>增长</strong></p></div><div><img src="data:image/png;base64,${png}" style="width:120px;height:80px;object-fit:cover" /><img src="data:image/png;base64,${png}" style="width:120px;height:80px;margin-left:12px;clip-path:inset(10px 20px 15px 25px)" /></div></div></section>
      <section class="slide"><h1>执行清单</h1><ol start="2"><li>准备材料</li><li>提交审核</li></ol><table style="width:480px"><tr><th>指标</th><th>数值</th></tr><tr><td>收入</td><td>42</td></tr></table></section>
      <section class="slide"><h1>数据趋势</h1><div data-pptx-chart='${marker('bar', [4, 6, 9])}' style="display:inline-block;width:400px;height:240px"><svg width="400" height="240"><line x1="40" y1="205" x2="370" y2="205" stroke="#888" />${bars}<text x="68" y="225">甲</text><text x="173" y="225">乙</text><text x="278" y="225">丙</text></svg></div><div data-pptx-chart='${marker('line', [5, 7, 8])}' style="display:inline-block;width:400px;height:240px"><svg width="400" height="240"><line x1="40" y1="205" x2="370" y2="205" stroke="#888" /><polyline points="${line}" fill="none" stroke="#c0504d" stroke-width="3" /><text x="75" y="225">甲</text><text x="180" y="225">乙</text><text x="285" y="225">丙</text></svg></div></section>
      <section class="slide"><h1>结构占比</h1><div data-pptx-chart='${marker('pie', [2, 3, 5])}' style="width:400px;height:240px"><div style="width:210px;height:210px;border-radius:50%;margin:15px auto;background:conic-gradient(#5da5da 0 20%,#faa43a 20% 50%,#60bd68 50% 100%)"></div></div></section>`);
    const destination = join(directory, 'quality-fixture.pptx');
    if (qaDirectory) await writeFile(join(directory, 'quality-fixture.html'), source);
    const result = await exportPptx(source, destination, {
      ...options,
      sourcePath: 'deck.html',
      renderMode: 'native',
    });
    expect(result.warnings?.some((warning) => warning.includes('rasterized')) ?? false).toBe(false);
    const unpacked = join(directory, 'quality-fixture-unpacked');
    await extract(destination, unpacked);
    const parser = new DOMParser();
    const slideTexts: string[][] = [];
    for (let page = 1; page <= 4; page++) {
      const slide = parser.parseFromString(
        await readFile(join(unpacked, `ppt/slides/slide${page}.xml`), 'utf8'),
        'application/xml',
      );
      slideTexts.push(
        Array.from(slide.getElementsByTagName('a:t')).map((node) => node.textContent ?? ''),
      );
      if (page === 2) expect(slide.getElementsByTagName('a:tbl')).toHaveLength(1);
    }
    expect(slideTexts[0]?.join('')).toBe('中文季度报告收入 增长');
    expect(slideTexts[1]?.join('')).toBe('执行清单准备材料提交审核指标数值收入42');
    expect(slideTexts[2]?.join('')).toBe('数据趋势');
    expect(slideTexts[3]?.join('')).toBe('结构占比');
    await expect(readFile(join(unpacked, 'ppt/slides/slide5.xml'))).rejects.toThrow();
    for (const [index, type] of ['bar', 'line', 'pie'].entries()) {
      const chartXml = parser.parseFromString(
        await readFile(join(unpacked, `ppt/charts/chart${index + 1}.xml`), 'utf8'),
        'application/xml',
      );
      expect(chartXml.getElementsByTagName('c:ser')).toHaveLength(1);
      expect(
        chartXml.getElementsByTagName('c:cat')[0]?.getElementsByTagName('c:strRef'),
      ).toHaveLength(1);
      expect(chartXml.getElementsByTagName('c:v')[0]?.textContent).toContain(type);
    }
  }, 60_000);

  it('executes JSX props and maps before exporting actual text to PPTX XML', async () => {
    const source = `const title = '真实标题'; const values = ['第一项', '第二项'];
      function App() { return <section data-pptx-slide style={{width:1280,height:720,padding:48,background:'#fff'}}><h1 style={{fontSize:48}}>{title}</h1>{values.map(value => <p key={value} style={{fontSize:24}}>{value}</p>)}</section>; }`;
    const destination = join(directory, 'jsx.pptx');
    const result = await exportPptx(source, destination, {
      ...options,
      sourcePath: 'App.jsx',
      renderMode: 'native',
    });
    expect(result.warnings?.some((warning) => warning.includes('rasterized')) ?? false).toBe(false);
    const unpacked = join(directory, 'jsx-unpacked');
    await extract(destination, unpacked);
    const xml = await readFile(join(unpacked, 'ppt/slides/slide1.xml'), 'utf8');
    expect(xml).toContain('<a:t>真实标题</a:t>');
    expect(xml).toContain('<a:t>第一项</a:t>');
    expect(xml).toContain('<a:t>第二项</a:t>');
    expect(xml).not.toContain('{title}');
    expect(xml).not.toContain('<p:pic>');
  }, 30_000);

  it('exports inactive slides and does not count nested sections as extra pages', async () => {
    const source = html(
      `<div class="slide active"><section><h1>One</h1></section></div><div class="slide"><section><h1>Two</h1></section></div>`,
      '.slide{display:none}.slide.active{display:block}',
    );
    const models = await renderNativeSlides(source, options);
    expect(models).toHaveLength(2);
    expect(
      models.map((model) =>
        model.elements
          .filter((el) => el.type === 'text')
          .flatMap((el) => el.runs.map((run) => run.text))
          .join(''),
      ),
    ).toEqual(['One', 'Two']);
  }, 30_000);

  it('rasterizes gradient decoration while retaining its native text', async () => {
    const source = html(
      `<section class="slide"><h1>Editable heading</h1><div style="background:linear-gradient(red,blue);width:400px;height:100px"><p>Raster text</p></div></section>`,
    );
    const models = await renderNativeSlides(source, options);
    const model = models[0];
    expect(model?.warnings.join(' ')).toContain('gradient');
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(1);
    expect(
      model?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Editable heading', 'Raster text']);
    const result = await exportPptx(source, join(directory, 'fallback.pptx'), {
      ...options,
      renderMode: 'native',
    });
    expect(result.warnings?.[0]).toContain('Slide 1:');
  }, 30_000);

  it('fits unstructured pages and still reports broken images and explicit selector errors', async () => {
    const fallback = await renderNativeSlides(html('<main><h1>No slides</h1></main>'), options);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]?.warnings.join(' ')).toContain('No explicit slide containers');
    expect(
      fallback[0]?.elements.some(
        (el) => el.type === 'text' && el.runs.some((run) => run.text === 'No slides'),
      ),
    ).toBe(true);
    await expect(
      renderNativeSlides(html('<main>Content</main>'), { ...options, slideSelector: '.missing' }),
    ).rejects.toThrow('slideSelector');
    await expect(
      renderNativeSlides(
        html('<section class="slide"><img src="data:image/png;base64,broken" /></section>'),
        options,
      ),
    ).rejects.toThrow('image failed to load');
  }, 30_000);

  it('measures hidden content-box slides after activation without shrinking their padding', async () => {
    const models = await renderNativeSlides(
      html(
        '<div class="slide active"><h1>One</h1></div><div class="slide"><h1>Two</h1></div>',
        '.slide{display:none;box-sizing:content-box;width:1000px;height:500px;padding:40px;border:10px solid black}.slide.active{display:block}',
      ),
      options,
    );
    expect(models.map((model) => [model.width, model.height])).toEqual([
      [1100, 600],
      [1100, 600],
    ]);
  }, 30_000);

  it('preserves aligned anonymous text, clipped text and image backgrounds using local fallback', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide"><h1>Native heading</h1><div style="display:flex;align-items:center;justify-content:center;width:400px;height:120px">Centered text</div><p style="width:80px;height:20px;overflow:hidden;white-space:nowrap">Long clipped text must not become a complete native paragraph</p><img style="width:96px;height:96px;background:#ff0000" src="data:image/png;base64,${png}" /></section>`,
      ),
      options,
    );
    const model = models[0];
    expect(
      model?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Native heading', 'Centered text']);
    expect(model?.elements.filter((el) => el.type === 'image')).toHaveLength(2);
    expect(model?.warnings.join(' ')).toContain('clipped text');
    expect(model?.warnings.join(' ')).toContain('image crop or format');
  }, 30_000);

  it('keeps text editable beside shadows and overlapping decoration captures', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><h1>Shadow heading</h1><div style="width:400px;height:100px;background:red;box-shadow:12px 12px 8px black"><p>Shadow card</p></div></section><section class="slide"><div style="width:400px;height:100px;background:linear-gradient(red,blue)"></div><p style="position:absolute;left:60px;top:60px">Overlapping foreground</p></section>',
      ),
      options,
    );
    expect(models).toHaveLength(2);
    for (const model of models) {
      expect(model.elements.some((el) => el.type === 'text')).toBe(true);
      expect(model.elements.filter((el) => el.type === 'image')).toHaveLength(1);
      expect(
        model.elements.some((el) => el.type === 'image' && el.width === 1280 && el.height === 720),
      ).toBe(false);
      expect(model.warnings.join(' ')).not.toContain('whole-slide fallback');
    }
  }, 30_000);

  it('finds all four pages in the bundled JSX slide pattern', async () => {
    const source = await readFile(
      new URL(
        '../../../apps/desktop/resources/templates/design-skills/slide-deck.jsx',
        import.meta.url,
      ),
      'utf8',
    );
    // Keep this resource smoke test offline without changing its layout or dynamic slide content.
    const offline = source.replace(/Fraunces|DM Serif Display|DM Sans|JetBrains Mono/g, 'Arial');
    const models = await renderNativeSlides(offline, { ...options, sourcePath: 'App.jsx' });
    expect(models).toHaveLength(4);
    expect(
      models[0]?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text))
        .join(' '),
    ).toContain('The slow practice of seeing.');
    expect(models.every((model) => model.elements.some((el) => el.type === 'text'))).toBe(true);
  }, 30_000);

  it('normalizes nested preview scales for geometry, typography, padding and pill radii', async () => {
    const snapshots = [];
    for (const scale of [0.5, 530 / 720, 1, 1.15]) {
      const models = await renderNativeSlides(
        html(
          `<div style="transform:scale(${scale});overflow:hidden;width:600px;height:300px"><div style="transform:translate(14px,20px)"><section class="slide"><h1 style="font-size:38px">Stable heading</h1><p style="padding:8px;border:1px solid black;border-radius:999px;width:260px">Pill label</p></section></div></div>`,
        ),
        options,
      );
      const m = models[0];
      expect([m?.width, m?.height]).toEqual([1280, 720]);
      expect(
        m?.elements.filter((e) => e.type === 'shape').every((e) => e.shape !== 'ellipse'),
      ).toBe(true);
      expect(m?.elements.find((e) => e.type === 'text')?.runs[0]?.fontSize).toBe(38);
      snapshots.push(
        m?.elements.map((e) => ({
          type: e.type,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          ...(e.type === 'text' ? { runs: e.runs } : {}),
        })),
      );
    }
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  }, 60_000);

  it('retains cover and card text with generated decorations and nonuniform borders', async () => {
    const models = await renderNativeSlides(
      html(
        `<section class="slide cover"><h1>Cover remains editable</h1><p>Ordinary cover text</p></section><section class="slide"><div class="card"><p class="bullet">Editable bullet text</p></div></section>`,
        `.cover::after{content:"";position:absolute;inset:0;background:linear-gradient(transparent,rgba(0,0,255,.2));pointer-events:none}.cover h1,.cover p{position:relative;z-index:2}.card{width:500px;padding:20px;border:1px solid gray;border-left:5px solid green;border-radius:12px}.bullet{position:relative;padding-left:16px}.bullet::before{content:"";position:absolute;left:0;top:10px;width:5px;height:5px;background:green;border-radius:50%}`,
      ),
      options,
    );
    expect(
      models.map((m) =>
        m.elements
          .filter((e) => e.type === 'text')
          .flatMap((e) => e.runs.map((r) => r.text))
          .join(' '),
      ),
    ).toEqual(['Cover remains editable Ordinary cover text', 'Editable bullet text']);
    expect(models[1]?.elements.some((e) => e.type === 'shape' && e.shape === 'ellipse')).toBe(true);
    expect(models.every((m) => !m.warnings.some((w) => w.includes('contents rasterized')))).toBe(
      true,
    );
  }, 30_000);

  it('writes measured lines for wrapping and mixed font sizes without automatic shrink', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide"><p style="width:220px;font-size:24px;line-height:1.6">Several words wrap into multiple separate lines.</p><p>Small <b style="font-size:32px">BIG</b> text</p></section>',
      ),
      options,
    );
    const texts = models[0]?.elements.filter((e) => e.type === 'text') ?? [];
    expect(texts.length).toBeGreaterThan(2);
    expect(texts.every((e) => e.layout === 'lines' && e.lineHeight === 1)).toBe(true);
    expect(texts.map((e) => e.runs.map((r) => r.text).join('')).join(' ')).toBe(
      'Several words wrap into multiple separate lines. Small BIG text',
    );
    expect(texts.some((e) => e.runs.some((r) => r.fontSize === 32))).toBe(true);
  }, 30_000);

  it('supports portrait dimensions without stretching and ignores explicitly excluded controls', async () => {
    const models = await renderNativeSlides(
      html(
        '<section class="slide" style="width:720px;height:1280px"><h1>Portrait</h1><button data-pptx-ignore>Next</button></section>',
      ),
      options,
    );
    expect(models[0]?.width).toBe(720);
    expect(models[0]?.height).toBe(1280);
    expect(models[0]?.warnings).toContain(
      'Non-16:9 slide fitted with whitespace; content was not stretched.',
    );
    expect(
      models[0]?.elements
        .filter((el) => el.type === 'text')
        .flatMap((el) => el.runs.map((run) => run.text)),
    ).toEqual(['Portrait']);
  }, 30_000);
});
