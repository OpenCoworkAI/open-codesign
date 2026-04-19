// Canonical definitions live in @open-codesign/shared to avoid a
// circular dependency: packages/providers needs LoadedSkill but
// packages/providers is already a dependency of packages/core.
// Re-export here so skill-internal code can import from './types.js'.
export { SkillFrontmatterV1 } from '@open-codesign/shared';
export type { LoadedSkill } from '@open-codesign/shared';
