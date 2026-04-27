import { CodesignError, ERROR_CODES } from '@open-codesign/shared';

export interface WorkspaceWriteContent {
  diskContent: string | Buffer;
  storedContent: string;
  isBinaryAsset: boolean;
}

const ASSET_DATA_URL_RE =
  /^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*);base64,([A-Za-z0-9+/]+={0,2})$/i;

function looksLikeAssetPath(path: string): boolean {
  return path.replaceAll('\\', '/').startsWith('assets/');
}

export function prepareWorkspaceWriteContent(path: string, content: string): WorkspaceWriteContent {
  const trimmedContent = content.trim();
  if (!looksLikeAssetPath(path) || !trimmedContent.startsWith('data:')) {
    return { diskContent: content, storedContent: content, isBinaryAsset: false };
  }

  const match = ASSET_DATA_URL_RE.exec(trimmedContent);
  if (match === null || match[2] === undefined) {
    throw new CodesignError(
      `Asset ${path} has malformed data URL content`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }

  const mimeType = match[1]?.toLowerCase() ?? '';
  const base64 = match[2];
  if (!mimeType.startsWith('image/')) {
    throw new CodesignError(
      `Asset ${path} data URL must use an image MIME type`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
  if (base64.length % 4 === 1) {
    throw new CodesignError(
      `Asset ${path} has malformed base64 image data`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) {
    throw new CodesignError(
      `Asset ${path} has empty image data`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
  validateImageSignature(path, mimeType, bytes);

  return { diskContent: bytes, storedContent: trimmedContent, isBinaryAsset: true };
}

function validateImageSignature(path: string, mimeType: string, bytes: Buffer): void {
  if (
    mimeType !== 'image/png' &&
    mimeType !== 'image/jpeg' &&
    mimeType !== 'image/jpg' &&
    mimeType !== 'image/webp'
  ) {
    throw new CodesignError(
      `Asset ${path} uses unsupported image MIME type ${mimeType}`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
  const valid =
    mimeType === 'image/png'
      ? bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      : mimeType === 'image/jpeg' || mimeType === 'image/jpg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mimeType === 'image/webp'
          ? bytes.length >= 12 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          : false;
  if (!valid) {
    throw new CodesignError(
      `Asset ${path} bytes do not match ${mimeType}`,
      ERROR_CODES.ARTIFACT_PROTOCOL_INVALID,
    );
  }
}
