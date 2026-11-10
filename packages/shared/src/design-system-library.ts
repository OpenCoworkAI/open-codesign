export interface LibraryDesignSystem {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  status: 'draft' | 'ready';
  source: { name: string; url?: string; license?: string; systemId?: string };
  sessionDesignId: string | null;
  workspacePath: string;
  thumbnail: string | null;
  issues: string[];
}

export interface LibraryDesignSystemDetail {
  system: LibraryDesignSystem;
  designMd: string;
  previewSource: string;
  fingerprint: string;
}

export interface CreateLibraryDesignSystemInput {
  name: string;
  description?: string;
}

export interface ImportLibraryDesignSystemInput {
  designId?: string;
}
