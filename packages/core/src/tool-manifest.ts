import {
  CURRENT_TOOL_ORDER,
  currentToolManifestEntries,
  type ToolManifestEntryV1,
} from '@open-codesign/shared';

export interface ToolAvailabilityDeps {
  fs: boolean;
  preview: boolean;
  image: boolean;
  workspaceReader: boolean;
  ask: boolean;
}

export function isToolAvailable(entry: ToolManifestEntryV1, deps: ToolAvailabilityDeps): boolean {
  if (entry.status !== 'current') return false;
  return entry.requires.every((requirement) => deps[requirement]);
}

export function availableToolManifestEntries(deps: ToolAvailabilityDeps): ToolManifestEntryV1[] {
  return currentToolManifestEntries().filter((entry) => isToolAvailable(entry, deps));
}

export function availableToolNames(deps: ToolAvailabilityDeps): string[] {
  return availableToolManifestEntries(deps).map((entry) => entry.name);
}

export { CURRENT_TOOL_ORDER };
