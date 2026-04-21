import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { type ExporterFormat, exportArtifact } from '@open-codesign/exporters';
import {
  CodesignError,
  ERROR_CODES,
  type LocalInputFile,
  type SshAuthMethod,
  type StoredDesignSystem,
} from '@open-codesign/shared';
import { Client } from 'ssh2';
import type { ConnectConfig, FileEntry, SFTPWrapper } from 'ssh2';
import {
  IGNORED_DESIGN_SYSTEM_DIRS,
  buildDesignSystemSnapshot,
  isDesignSystemCandidateFile,
  scoreDesignSystemCandidate,
} from './design-system';
import { decryptSecret } from './keychain';
import { getCachedConfig } from './onboarding-ipc';

const MAX_REMOTE_SCAN_FILES = 160;
const MAX_REMOTE_SCAN_SELECTED_FILES = 12;
const S_IFDIR = 0o040000;

export interface SshProfileInput {
  id: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  basePath?: string;
}

interface ResolvedProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  basePath?: string;
}

function normalizeRemotePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (trimmed.length === 0) {
    throw new CodesignError('Remote path cannot be empty', ERROR_CODES.SSH_REMOTE_PATH_INVALID);
  }
  if (trimmed.includes('\0')) {
    throw new CodesignError(
      'Remote path contains invalid characters',
      ERROR_CODES.SSH_REMOTE_PATH_INVALID,
    );
  }
  const normalized = posix.normalize(trimmed);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new CodesignError(
      'Remote path traversal is not allowed',
      ERROR_CODES.SSH_REMOTE_PATH_INVALID,
    );
  }
  return normalized;
}

function resolveProfilePath(profile: { basePath?: string }, remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath);
  if (normalized.startsWith('/')) return normalized;
  if (profile.basePath && profile.basePath.trim().length > 0) {
    return normalizeRemotePath(posix.join(profile.basePath.replace(/\\/g, '/'), normalized));
  }
  return normalized;
}

function resolveStoredProfile(profileId: string): ResolvedProfile {
  const cfg = getCachedConfig();
  const stored = cfg?.sshProfiles?.[profileId];
  if (!stored) {
    throw new CodesignError(
      `SSH profile "${profileId}" not found`,
      ERROR_CODES.SSH_PROFILE_NOT_FOUND,
    );
  }
  return {
    id: stored.id,
    name: stored.name,
    host: stored.host,
    port: stored.port,
    username: stored.username,
    authMethod: stored.authMethod,
    ...(stored.password ? { password: decryptSecret(stored.password.ciphertext) } : {}),
    ...(stored.keyPath ? { keyPath: stored.keyPath } : {}),
    ...(stored.passphrase ? { passphrase: decryptSecret(stored.passphrase.ciphertext) } : {}),
    ...(stored.basePath ? { basePath: stored.basePath } : {}),
  };
}

async function toConnectConfig(profile: ResolvedProfile): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 10_000,
  };
  if (profile.authMethod === 'password') {
    if (!profile.password || profile.password.length === 0) {
      throw new CodesignError(
        `SSH profile "${profile.name}" is missing a password`,
        ERROR_CODES.SSH_CONNECT_FAILED,
      );
    }
    return { ...base, password: profile.password };
  }
  if (!profile.keyPath || profile.keyPath.trim().length === 0) {
    throw new CodesignError(
      `SSH profile "${profile.name}" is missing a private key path`,
      ERROR_CODES.SSH_KEY_READ_FAILED,
    );
  }
  try {
    const privateKey = await readFile(profile.keyPath, 'utf8');
    return {
      ...base,
      privateKey,
      ...(profile.passphrase ? { passphrase: profile.passphrase } : {}),
    };
  } catch (error) {
    throw new CodesignError(
      `Failed to read SSH private key at ${profile.keyPath}`,
      ERROR_CODES.SSH_KEY_READ_FAILED,
      { cause: error },
    );
  }
}

async function connectSftp(
  profile: ResolvedProfile,
): Promise<{ client: Client; sftp: SFTPWrapper }> {
  const config = await toConnectConfig(profile);
  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client
      .once('ready', () => resolve())
      .once('error', (error) =>
        reject(
          new CodesignError(
            `Failed to connect to SSH server ${profile.host}:${profile.port}`,
            ERROR_CODES.SSH_CONNECT_FAILED,
            { cause: error },
          ),
        ),
      )
      .connect(config);
  });
  try {
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, next) => {
        if (error || !next) {
          reject(
            new CodesignError(
              `Failed to start SFTP session for ${profile.host}`,
              ERROR_CODES.SSH_SFTP_FAILED,
              { cause: error },
            ),
          );
          return;
        }
        resolve(next);
      });
    });
    return { client, sftp };
  } catch (error) {
    client.end();
    throw error;
  }
}

async function withSftp<T>(
  profile: ResolvedProfile,
  run: (sftp: SFTPWrapper) => Promise<T>,
): Promise<T> {
  const { client, sftp } = await connectSftp(profile);
  try {
    return await run(sftp);
  } finally {
    client.end();
  }
}

function isDirectoryMode(mode: number | undefined): boolean {
  return typeof mode === 'number' && (mode & S_IFDIR) === S_IFDIR;
}

function statRemote(
  sftp: SFTPWrapper,
  remotePath: string,
): Promise<{ size: number; isDirectory: boolean }> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error || !stats) {
        reject(
          new CodesignError(
            `Failed to stat remote path ${remotePath}`,
            ERROR_CODES.SSH_REMOTE_READ_FAILED,
            { cause: error },
          ),
        );
        return;
      }
      resolve({ size: stats.size, isDirectory: isDirectoryMode(stats.mode) });
    });
  });
}

function readDirRemote(sftp: SFTPWrapper, remotePath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => {
      if (error || !list) {
        reject(
          new CodesignError(
            `Failed to read remote directory ${remotePath}`,
            ERROR_CODES.SSH_REMOTE_READ_FAILED,
            { cause: error },
          ),
        );
        return;
      }
      resolve(list);
    });
  });
}

function readRemoteFileBuffer(
  sftp: SFTPWrapper,
  remotePath: string,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = sftp.createReadStream(remotePath);
    stream.on('data', (chunk: Buffer | string) => {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += next.length;
      if (total > maxBytes) {
        stream.destroy(
          new CodesignError(
            `Remote file ${remotePath} exceeds the allowed size`,
            ERROR_CODES.ATTACHMENT_TOO_LARGE,
          ),
        );
        return;
      }
      chunks.push(next);
    });
    stream.once('error', (error: unknown) => {
      reject(
        error instanceof CodesignError
          ? error
          : new CodesignError(
              `Failed to read remote file ${remotePath}`,
              ERROR_CODES.SSH_REMOTE_READ_FAILED,
              { cause: error },
            ),
      );
    });
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function ensureRemoteDir(sftp: SFTPWrapper, dirPath: string): Promise<void> {
  if (!dirPath || dirPath === '.' || dirPath === '/') return;
  const target = normalizeRemotePath(dirPath);
  const parts = target.split('/').filter(Boolean);
  let current = target.startsWith('/') ? '/' : '';
  for (const part of parts) {
    current = current === '/' ? `/${part}` : current ? `${current}/${part}` : part;
    try {
      const stat = await statRemote(sftp, current);
      if (!stat.isDirectory) {
        throw new CodesignError(
          `${current} exists but is not a directory`,
          ERROR_CODES.SSH_REMOTE_WRITE_FAILED,
        );
      }
    } catch (error) {
      if (error instanceof CodesignError && error.code !== ERROR_CODES.SSH_REMOTE_READ_FAILED) {
        throw error;
      }
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(current, (mkdirError: unknown) => {
          if (!mkdirError) {
            resolve();
            return;
          }
          reject(
            new CodesignError(
              `Failed to create remote directory ${current}`,
              ERROR_CODES.SSH_REMOTE_WRITE_FAILED,
              { cause: mkdirError },
            ),
          );
        });
      });
    }
  }
}

function writeRemoteBuffer(sftp: SFTPWrapper, remotePath: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.once('error', (error: unknown) =>
      reject(
        new CodesignError(
          `Failed to write remote file ${remotePath}`,
          ERROR_CODES.SSH_REMOTE_WRITE_FAILED,
          { cause: error },
        ),
      ),
    );
    stream.once('close', () => resolve());
    stream.end(content);
  });
}

function fileEntryIsDirectory(entry: FileEntry): boolean {
  return isDirectoryMode(entry.attrs.mode) || entry.longname.startsWith('d');
}

async function collectRemoteCandidates(
  sftp: SFTPWrapper,
  rootPath: string,
  dirPath: string,
  files: Array<{ fullPath: string; relativePath: string; score: number }>,
): Promise<void> {
  if (files.length >= MAX_REMOTE_SCAN_FILES) return;
  let entries: FileEntry[] = [];
  try {
    entries = await readDirRemote(sftp, dirPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_REMOTE_SCAN_FILES) return;
    const fullPath = posix.join(dirPath, entry.filename);
    if (fileEntryIsDirectory(entry)) {
      if (!IGNORED_DESIGN_SYSTEM_DIRS.has(entry.filename)) {
        await collectRemoteCandidates(sftp, rootPath, fullPath, files);
      }
      continue;
    }
    if (!isDesignSystemCandidateFile(entry.filename)) continue;
    const relativePath = posix.relative(rootPath, fullPath).replace(/\\/g, '/');
    files.push({
      fullPath,
      relativePath,
      score: scoreDesignSystemCandidate(relativePath),
    });
  }
}

export async function testSshConnection(input: SshProfileInput): Promise<void> {
  const profile: ResolvedProfile = {
    id: input.id,
    name: input.name,
    host: input.host.trim(),
    port: input.port ?? 22,
    username: input.username.trim(),
    authMethod: input.authMethod,
    ...(input.password ? { password: input.password } : {}),
    ...(input.keyPath ? { keyPath: input.keyPath.trim() } : {}),
    ...(input.passphrase ? { passphrase: input.passphrase } : {}),
    ...(input.basePath ? { basePath: input.basePath.trim() } : {}),
  };
  await withSftp(profile, async () => undefined);
}

export async function testSavedSshProfile(profileId: string): Promise<void> {
  const profile = resolveStoredProfile(profileId);
  await withSftp(profile, async () => undefined);
}

export async function createRemoteAttachment(
  profileId: string,
  remotePath: string,
): Promise<LocalInputFile> {
  const profile = resolveStoredProfile(profileId);
  const resolvedPath = resolveProfilePath(profile, remotePath);
  return withSftp(profile, async (sftp) => {
    const stat = await statRemote(sftp, resolvedPath);
    if (stat.isDirectory) {
      throw new CodesignError(
        `${resolvedPath} is a directory, not a file`,
        ERROR_CODES.SSH_REMOTE_PATH_INVALID,
      );
    }
    return {
      kind: 'ssh',
      profileId,
      path: resolvedPath,
      name: posix.basename(resolvedPath),
      size: stat.size,
      displayPath: `${profile.username}@${profile.host}:${resolvedPath}`,
    };
  });
}

export async function readRemoteAttachment(
  profileId: string,
  remotePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const profile = resolveStoredProfile(profileId);
  return withSftp(profile, async (sftp) =>
    readRemoteFileBuffer(sftp, resolveProfilePath(profile, remotePath), maxBytes),
  );
}

export async function scanRemoteDesignSystem(
  profileId: string,
  remoteRootPath: string,
): Promise<StoredDesignSystem> {
  const profile = resolveStoredProfile(profileId);
  const rootPath = resolveProfilePath(profile, remoteRootPath);
  return withSftp(profile, async (sftp) => {
    const candidates: Array<{ fullPath: string; relativePath: string; score: number }> = [];
    await collectRemoteCandidates(sftp, rootPath, rootPath, candidates);
    const selected = candidates
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .slice(0, MAX_REMOTE_SCAN_SELECTED_FILES);
    const files = await Promise.all(
      selected.map(async (file) => ({
        relativePath: file.relativePath,
        content: (await readRemoteFileBuffer(sftp, file.fullPath)).toString('utf8'),
      })),
    );
    return buildDesignSystemSnapshot(rootPath, files, {
      sourceKind: 'ssh',
      sshProfileId: profile.id,
      sshHost: profile.host,
      sshPort: profile.port,
      sshUsername: profile.username,
    });
  });
}

export async function writeRemoteFile(
  profileId: string,
  remotePath: string,
  content: Buffer,
): Promise<{ path: string; bytes: number }> {
  const profile = resolveStoredProfile(profileId);
  const resolvedPath = resolveProfilePath(profile, remotePath);
  return withSftp(profile, async (sftp) => {
    await ensureRemoteDir(sftp, posix.dirname(resolvedPath));
    await writeRemoteBuffer(sftp, resolvedPath, content);
    return { path: resolvedPath, bytes: content.length };
  });
}

export async function exportToRemote(
  profileId: string,
  remotePath: string,
  format: ExporterFormat,
  htmlContent: string,
): Promise<{ path: string; bytes: number }> {
  const ext = format === 'markdown' ? 'md' : format;
  const tempPath = join(tmpdir(), `open-codesign-remote-${randomUUID()}.${ext}`);
  try {
    const result = await exportArtifact(format, htmlContent, tempPath);
    const body = await readFile(result.path);
    return writeRemoteFile(profileId, remotePath, body);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
