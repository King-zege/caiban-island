export type KnowledgeExtractState = 'indexed' | 'metadata_only' | 'skipped' | 'failed';
export type KnowledgeLocatorKind = 'page' | 'sheet' | 'slide' | 'paragraph' | 'line' | 'path';

export interface KnowledgeSource {
  id: string;
  directoryId: string;
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAtUtc: string;
  fingerprint: string;
  extractState: KnowledgeExtractState;
  skipReason: string | null;
  projectCandidate: string | null;
  chunkCount: number;
  updatedAtUtc: string;
}

export interface KnowledgeMatch {
  sourceId: string;
  relativePath: string;
  fileName: string;
  locator: string;
  locatorKind: KnowledgeLocatorKind;
  excerpt: string;
  score: number;
  safetyFlags: Array<'prompt_injection' | 'credential' | 'sensitive_path'>;
}

export interface KnowledgeSourceExcerpt {
  source: KnowledgeSource;
  locator: string;
  text: string;
  safetyFlags: KnowledgeMatch['safetyFlags'];
}

export interface WorkspaceTreeEntry {
  relativePath: string;
  name: string;
  kind: 'directory' | 'file';
  size: number;
  indexedState: KnowledgeExtractState | null;
  children?: WorkspaceTreeEntry[];
}

export interface KnowledgeScanSummary {
  id: string;
  directoryId: string;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  totalFiles: number;
  indexedFiles: number;
  metadataOnlyFiles: number;
  skippedFiles: number;
  failedFiles: number;
  removedFiles: number;
  startedAtUtc: string;
  completedAtUtc: string | null;
  errorCategory: string | null;
}

export interface KnowledgeWorkspaceStatus {
  primaryDirectoryId: string | null;
  primaryDirectoryLabel: string | null;
  hasPrimaryDirectory: boolean;
  lastScan: KnowledgeScanSummary | null;
  sourceCount: number;
  indexedSourceCount: number;
  failedSourceCount: number;
}

export interface WorkspaceProjectBindingRequest {
  directoryId: string;
  relativeRoot: string;
  taskId: string;
}
