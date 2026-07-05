import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import {
  collectLocalAssetsFromHtml,
  type LocalAssetOptions,
  rewriteHtmlLocalAssetReferences,
} from './assets';
import { buildHtmlDocument } from './html';
import type { ExportResult } from './index';

export interface ZipAsset {
  /** Path inside the archive, e.g. `assets/logo.svg`. */
  path: string;
  /** Raw bytes or UTF-8 string. */
  content: Buffer | string;
}

export interface ExportZipOptions extends LocalAssetOptions {
  /** Extra files to bundle alongside `index.html` and the README. */
  assets?: ZipAsset[];
  /** Automatically bundle local src/href/url() references when assetBasePath is set. */
  collectLocalAssets?: boolean;
  /** Include the original source under source/<sourcePath>. Defaults to true. */
  includeSource?: boolean;
  /** Override the README banner. */
  readmeTitle?: string;
}

const README_TEMPLATE = (title: string, generatedAt: string) => `# ${title}

This bundle was exported from [open-codesign](https://github.com/OpenCoworkAI/open-codesign).

## Layout

\`\`\`
.
├── index.html      The exported design (open in any browser)
├── manifest.json   Machine-readable export metadata
├── source/         Original design source used for this export
├── DESIGN.md       Design system handoff file (when present in workspace)
├── assets/         Linked assets (images, fonts, scripts)
└── README.md       This file
\`\`\`

## Notes

- Generated: ${generatedAt}
- \`index.html\` is the portable rendered handoff.
- \`source/\` preserves the editable source used to produce this export.
`;

/**
 * Bundle a design source artifact + assets into a portable ZIP using `zip-lib`.
 * JSX sources are first exported as browser-openable `index.html`.
 *
 * Tier 1: deterministic layout (`index.html` at root, assets under `assets/`,
 * README at root). We pick zip-lib over yauzl/jszip because it ships ~80 KB,
 * MIT, zero deps, and handles streamed writes without buffering the whole
 * archive in memory (PRINCIPLES §1).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: existing complexity, see #118
export async function exportZip(
  artifactSource: string,
  destinationPath: string,
  opts: ExportZipOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const { Zip } = await import('zip-lib');

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-zip-'));
  try {
    const htmlDocument = buildHtmlDocument(artifactSource, {
      prettify: false,
      sourcePath: opts.sourcePath,
    });
    const collectedAssets =
      (opts.collectLocalAssets ?? true) ? await collectLocalAssetsFromHtml(htmlDocument, opts) : [];
    const exportHtml =
      (opts.collectLocalAssets ?? true)
        ? rewriteHtmlLocalAssetReferences(htmlDocument, opts)
        : htmlDocument;

    const indexPath = path.join(stagingDir, 'index.html');
    await fs.writeFile(indexPath, exportHtml, 'utf8');

    const generatedAt = new Date().toISOString();
    const readme = README_TEMPLATE(opts.readmeTitle ?? 'open-codesign export', generatedAt);
    const readmePath = path.join(stagingDir, 'README.md');
    await fs.writeFile(readmePath, readme, 'utf8');

    const zip = new Zip();
    zip.addFile(indexPath, 'index.html');
    zip.addFile(readmePath, 'README.md');

    const designMdAssets: ZipAsset[] = [];
    if (opts.assetRootPath) {
      try {
        const designMd = await fs.readFile(path.join(opts.assetRootPath, 'DESIGN.md'), 'utf8');
        designMdAssets.push({ path: 'DESIGN.md', content: designMd });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    const sourceAssets: ZipAsset[] =
      (opts.includeSource ?? true)
        ? [
            {
              path: sourceArchivePath(opts.sourcePath ?? 'App.jsx'),
              content: artifactSource,
            },
          ]
        : [];
    const manifestFiles = [
      'index.html',
      'README.md',
      'manifest.json',
      ...collectedAssets.map((asset) => asset.path),
      ...designMdAssets.map((asset) => asset.path),
      ...sourceAssets.map((asset) => asset.path),
      ...(opts.assets ?? []).map((asset) => asset.path.replace(/\\/g, '/').replace(/^\/+/, '')),
    ]
      .filter((file, index, list) => file.length > 0 && list.indexOf(file) === index)
      .sort((a, b) => a.localeCompare(b));
    const manifest: ZipAsset = {
      path: 'manifest.json',
      content: `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt,
          sourcePath: opts.sourcePath ?? 'App.jsx',
          files: manifestFiles,
        },
        null,
        2,
      )}\n`,
    };
    const assets = [
      ...collectedAssets,
      ...designMdAssets,
      ...sourceAssets,
      manifest,
      ...(opts.assets ?? []),
    ];
    if (assets.length > 0) {
      const stagingResolved = path.resolve(stagingDir);
      const written = new Set<string>();
      for (const asset of assets) {
        // Normalize backslashes first: on POSIX `path.resolve` treats `\` as a
        // literal char, so a Windows-style ZIP entry like `..\..\etc\passwd`
        // would slip past the containment check unless rewritten to `/`.
        const normalized = asset.path.replace(/\\/g, '/').replace(/^\/+/, '');
        if (written.has(normalized)) continue;
        const localPath = path.resolve(stagingDir, normalized);
        const rel = path.relative(stagingResolved, localPath);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new CodesignError(
            `ZIP export rejected unsafe asset path: ${asset.path}`,
            ERROR_CODES.EXPORTER_ZIP_UNSAFE_PATH,
          );
        }
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, asset.content);
        zip.addFile(localPath, normalized);
        written.add(normalized);
      }
    }

    await zip.archive(destinationPath);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      `ZIP export failed: ${err instanceof Error ? err.message : String(err)}`,
      ERROR_CODES.EXPORTER_ZIP_FAILED,
      { cause: err },
    );
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}

function sourceArchivePath(sourcePath: string): string {
  const normalized = sourcePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    return 'source/App.jsx';
  }
  return `source/${normalized}`;
}
