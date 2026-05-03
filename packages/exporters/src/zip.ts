import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import {
  collectLocalAssetsFromHtml,
  type LocalAssetOptions,
  rewriteHtmlLocalAssetReferences,
} from './assets';
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
  /** Override the README banner. */
  readmeTitle?: string;
}

const README_TEMPLATE = (title: string, generatedAt: string) => `# ${title}

This bundle was exported from [open-codesign](https://github.com/OpenCoworkAI/open-codesign).

## Layout

\`\`\`
.
├── index.html      The exported design (open in any browser)
├── assets/         Linked assets (images, fonts, scripts)
└── README.md       This file
\`\`\`

## Notes

- Generated: ${generatedAt}
- The HTML is self-contained; opening \`index.html\` directly works without a server.
- To re-edit, open the bundle in open-codesign via *File → Import bundle*.
`;

/**
 * Bundle an HTML artifact + assets into a portable ZIP using `zip-lib`.
 *
 * Tier 1: deterministic layout (`index.html` at root, assets under `assets/`,
 * README at root). We pick zip-lib over yauzl/jszip because it ships ~80 KB,
 * MIT, zero deps, and handles streamed writes without buffering the whole
 * archive in memory (PRINCIPLES §1).
 */
export async function exportZip(
  htmlContent: string,
  destinationPath: string,
  opts: ExportZipOptions = {},
): Promise<ExportResult> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const { Zip } = await import('zip-lib');

  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesign-zip-'));
  try {
    const collectedAssets =
      (opts.collectLocalAssets ?? true) ? await collectLocalAssetsFromHtml(htmlContent, opts) : [];
    const exportHtml =
      (opts.collectLocalAssets ?? true)
        ? rewriteHtmlLocalAssetReferences(htmlContent, opts)
        : htmlContent;

    const indexPath = path.join(stagingDir, 'index.html');
    await fs.writeFile(indexPath, exportHtml, 'utf8');

    const readme = README_TEMPLATE(
      opts.readmeTitle ?? 'open-codesign export',
      new Date().toISOString(),
    );
    const readmePath = path.join(stagingDir, 'README.md');
    await fs.writeFile(readmePath, readme, 'utf8');

    const zip = new Zip();
    zip.addFile(indexPath, 'index.html');
    zip.addFile(readmePath, 'README.md');

    const assets = [...collectedAssets, ...(opts.assets ?? [])];
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
