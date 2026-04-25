function stripTrailingSlash(value: string): string {
  if (value === '/' || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, '');
}

function isWindowsPlatform(platform: string): boolean {
  return platform.toLowerCase().includes('win');
}

export function workspacePathComparisonKey(path: string, platform = navigator.platform): string {
  const normalized = stripTrailingSlash(path.replaceAll('\\', '/'));
  return isWindowsPlatform(platform) ? normalized.toLowerCase() : normalized;
}
