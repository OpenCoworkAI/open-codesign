/**
 * Thin re-export shim — the implementation was split into ./db/ per domain.
 * Existing importers (tests, IPC handlers) continue to work unchanged.
 */

export * from './db';
