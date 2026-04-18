import { CodesignError } from '@open-codesign/shared';
import type { ExportResult } from './index';

export interface ZipAsset {
  /** Path inside the archive, e.g. `assets/logo.svg`. */
  path: string;
  /** Raw bytes or UTF-8 string. */
  content: Buffer | string;
}

export interface ExportZipOptions {
  /** Extra files to bundle alongside `index.html` and the README. */
  assets?: ZipAsset[];
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
 * MIT, zero deps, and is the only Node-native zip writer we tested that
 * handles >2 GB streams without blowing memory (PRINCIPLES §1).
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
    const indexPath = path.join(stagingDir, 'index.html');
    await fs.writeFile(indexPath, htmlContent, 'utf8');

    const readme = README_TEMPLATE(
      opts.readmeTitle ?? 'open-codesign export',
      new Date().toISOString(),
    );
    const readmePath = path.join(stagingDir, 'README.md');
    await fs.writeFile(readmePath, readme, 'utf8');

    const zip = new Zip();
    zip.addFile(indexPath, 'index.html');
    zip.addFile(readmePath, 'README.md');

    if (opts.assets) {
      for (const asset of opts.assets) {
        const safeRel = asset.path.replace(/^\/+/, '');
        const localPath = path.join(stagingDir, safeRel);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(
          localPath,
          typeof asset.content === 'string' ? asset.content : asset.content,
        );
        zip.addFile(localPath, safeRel);
      }
    }

    await zip.archive(destinationPath);
    const stat = await fs.stat(destinationPath);
    return { bytes: stat.size, path: destinationPath };
  } catch (err) {
    throw new CodesignError(
      `ZIP export failed: ${err instanceof Error ? err.message : String(err)}`,
      'EXPORTER_ZIP_FAILED',
      { cause: err },
    );
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}
