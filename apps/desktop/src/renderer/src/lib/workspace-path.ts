function stripTrailingSlash(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, '');
}

function isWindowsPlatform(platform: string): boolean {
  return platform.toLowerCase().includes('win');
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || /^\/\/[^/]+\/[^/]+/.test(path);
}

export function workspacePathComparisonKey(path: string, platform?: string): string {
  const normalized = stripTrailingSlash(path.replaceAll('\\', '/'));
  return (platform === undefined ? isWindowsPath(normalized) : isWindowsPlatform(platform))
    ? normalized.toLowerCase()
    : normalized;
}
