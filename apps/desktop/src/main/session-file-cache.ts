import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { SessionManager } from '@open-codesign/core';
import { CodesignError } from '@open-codesign/shared';

type Entry = ReturnType<SessionManager['getEntries']>[number];
type FileStamp = { key: string; size: number };
export interface CachedSession<T> {
  file: string;
  cwd: string;
  identity: string;
  manager: SessionManager;
  state: T;
  stamp: FileStamp | null;
}

function stamp(file: string): FileStamp | null {
  try {
    const stat = statSync(file, { bigint: true });
    return {
      key: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
      size: Number(stat.size),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertSessionHeader(file: string): boolean {
  // SessionManager.open resets headerless files. A read/projection must never
  // destroy a damaged log, so validate its first record before giving pi the file.
  const fd = openSync(file, 'r');
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (length < 1024 * 1024) {
      const buffer = Buffer.allocUnsafe(4096);
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      const newline = buffer.subarray(0, read).indexOf(10);
      const chunk = buffer.subarray(0, newline < 0 ? read : newline);
      chunks.push(chunk);
      length += chunk.length;
      if (newline >= 0) break;
    }
    const header: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8').trim());
    if (
      typeof header !== 'object' ||
      header === null ||
      !('type' in header) ||
      header.type !== 'session' ||
      !('id' in header) ||
      typeof header.id !== 'string'
    )
      throw new Error('Invalid header');
    const version = 'version' in header ? header.version : undefined;
    if (
      version !== undefined &&
      (typeof version !== 'number' ||
        !Number.isInteger(version) ||
        version < 1 ||
        version > CURRENT_SESSION_VERSION)
    ) {
      throw new Error('Invalid session version');
    }
    return version !== CURRENT_SESSION_VERSION;
  } catch (cause) {
    throw new CodesignError(
      'Session header is damaged; the original file was left unchanged.',
      'IPC_DB_ERROR',
      { cause },
    );
  } finally {
    closeSync(fd);
  }
}

function assertLegacyRecords(file: string): void {
  // pi migration rewrites a legacy log. Validate every original JSONL record
  // first so its tolerant reader cannot silently discard interrupted bytes.
  const fd = openSync(file, 'r');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = '';
  const validate = (line: string) => {
    if (!line.trim()) return;
    const record: unknown = JSON.parse(line);
    if (
      typeof record !== 'object' ||
      record === null ||
      Array.isArray(record) ||
      !('type' in record) ||
      typeof record.type !== 'string'
    )
      throw new Error('Invalid legacy record');
  };
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      pending += decoder.decode(buffer.subarray(0, read), { stream: true });
      let start = 0;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(start, newline).trim();
        validate(line);
        start = newline + 1;
        newline = pending.indexOf('\n', start);
      }
      pending = pending.slice(start);
    }
    pending += decoder.decode();
    validate(pending);
  } catch (cause) {
    throw new CodesignError(
      'Legacy session contains damaged records; the original file was left unchanged.',
      'IPC_DB_ERROR',
      { cause },
    );
  } finally {
    closeSync(fd);
  }
}

/** Keep pi as the record writer, with bounded derived state for hot event paths. */
export class SessionFileCache<T> {
  private readonly sessions = new Map<string, CachedSession<T>>();
  constructor(
    private readonly build: (manager: SessionManager, identity: string) => T,
    private readonly apply: (state: T, entry: Entry) => void,
  ) {}

  get(file: string, cwd: string, identity: string, create = false): CachedSession<T> | null {
    file = path.resolve(file);
    const current = stamp(file);
    if (!current && !create) {
      this.sessions.delete(file);
      return null;
    }
    const cached = this.sessions.get(file);
    if (
      cached &&
      cached.cwd === cwd &&
      cached.identity === identity &&
      cached.stamp?.key === current?.key
    ) {
      this.sessions.delete(file);
      this.sessions.set(file, cached);
      return cached;
    }
    this.sessions.delete(file);
    if (!current && !create) return null;
    const legacy = current ? assertSessionHeader(file) : false;
    if (create) mkdirSync(path.dirname(file), { recursive: true });
    let legacyState: T | undefined;
    if (legacy) {
      assertLegacyRecords(file);
      const readonly = SessionManager.inMemory(cwd);
      readonly.setSessionFile(file);
      // Validate app-specific data before the persisted manager migrates it.
      legacyState = this.build(readonly, identity);
    }
    const manager = SessionManager.open(file, path.dirname(file), cwd);
    const entry = {
      file,
      cwd,
      identity,
      manager,
      state: legacyState ?? this.build(manager, identity),
      stamp: stamp(file),
    };
    this.sessions.set(file, entry);
    this.trim();
    return entry;
  }

  append(session: CachedSession<T>, customType: string, data: unknown): Entry {
    try {
      if (stamp(session.file)?.key !== session.stamp?.key) {
        throw new CodesignError(
          'Session changed before the write; retry the operation.',
          'IPC_DB_ERROR',
        );
      }
      if (session.stamp && session.stamp.size > 0) {
        const fd = openSync(session.file, 'r');
        const last = Buffer.allocUnsafe(1);
        try {
          readSync(fd, last, 0, 1, session.stamp.size - 1);
        } finally {
          closeSync(fd);
        }
        // Preserve an interrupted final record, but keep the next pi entry on
        // its own JSONL line. This also handles a complete line without a newline.
        if (last[0] !== 10) appendFileSync(session.file, '\n');
      }
      const id = session.manager.appendCustomEntry(customType, structuredClone(data));
      const entry = session.manager.getEntry(id);
      if (!entry) throw new CodesignError('Session entry unavailable', 'IPC_DB_ERROR');
      if (!session.stamp) {
        const header = session.manager.getHeader();
        if (!header) throw new CodesignError('Session header unavailable', 'IPC_DB_ERROR');
        // pi defers new custom-only sessions. Persist the initial header once,
        // exclusively, then reopen so subsequent appends use pi's flushed path.
        const initial = [header, ...session.manager.getEntries()]
          .map((row) => JSON.stringify(row))
          .join('\n');
        writeFileSync(session.file, `${initial}\n`, { encoding: 'utf8', flag: 'wx' });
        session.manager = SessionManager.open(
          session.file,
          path.dirname(session.file),
          session.cwd,
        );
      }
      session.stamp = stamp(session.file);
      if (!session.stamp)
        throw new CodesignError('Session disappeared during the write.', 'IPC_DB_ERROR');
      this.apply(session.state, entry);
      this.trim();
      return structuredClone(entry);
    } catch (error) {
      this.sessions.delete(session.file);
      throw error;
    }
  }

  private trim(): void {
    let bytes = [...this.sessions.values()].reduce(
      (total, session) => total + (session.stamp?.size ?? 0),
      0,
    );
    while (this.sessions.size > 1 && (this.sessions.size > 8 || bytes > 32 * 1024 * 1024)) {
      const oldest = this.sessions.entries().next().value;
      if (!oldest) break;
      bytes -= oldest[1].stamp?.size ?? 0;
      this.sessions.delete(oldest[0]);
    }
  }
}
