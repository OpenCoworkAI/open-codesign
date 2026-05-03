export function getUpdateErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isMissingUpdateMetadataError(err: unknown): boolean {
  const message = getUpdateErrorMessage(err);
  return /\b404\b/i.test(message) && /latest(?:-[a-z0-9_-]+)?\.ya?ml/i.test(message);
}
