import { getChangedFiles, getDiffStat, getDiffSummaryPatch, getNameStatus } from "../../local-runner/src/git.js";

export const DIFF_ARTIFACT_RETENTION = {
  storage: "ephemeral",
  persisted: false,
  patchPreviewMaxChars: 20_000,
  diffStatMaxChars: 10_000,
  nameStatusMaxChars: 10_000,
  changedFilesMaxCount: 200
} as const;

export interface DiffArtifactRetention {
  storage: typeof DIFF_ARTIFACT_RETENTION.storage;
  persisted: typeof DIFF_ARTIFACT_RETENTION.persisted;
  generatedAt: string;
  limits: {
    patchPreviewMaxChars: number;
    diffStatMaxChars: number;
    nameStatusMaxChars: number;
    changedFilesMaxCount: number;
  };
}

export interface DiffSummary {
  changedFiles: string[];
  diffStat: string;
  nameStatus?: string;
  patchPreview?: string;
  retention?: DiffArtifactRetention;
}

export async function collectDiffSummary(workspacePath: string): Promise<DiffSummary> {
  const [changedFiles, diffStat, nameStatus, patchPreview] = await Promise.all([
    getChangedFiles(workspacePath),
    getDiffStat(workspacePath),
    getNameStatus(workspacePath),
    getDiffSummaryPatch(workspacePath)
  ]);

  return {
    changedFiles: changedFiles.slice(0, DIFF_ARTIFACT_RETENTION.changedFilesMaxCount),
    diffStat: truncateArtifact(diffStat, DIFF_ARTIFACT_RETENTION.diffStatMaxChars),
    nameStatus: truncateArtifact(nameStatus, DIFF_ARTIFACT_RETENTION.nameStatusMaxChars),
    patchPreview: truncateArtifact(patchPreview, DIFF_ARTIFACT_RETENTION.patchPreviewMaxChars),
    retention: {
      storage: DIFF_ARTIFACT_RETENTION.storage,
      persisted: DIFF_ARTIFACT_RETENTION.persisted,
      generatedAt: new Date().toISOString(),
      limits: {
        patchPreviewMaxChars: DIFF_ARTIFACT_RETENTION.patchPreviewMaxChars,
        diffStatMaxChars: DIFF_ARTIFACT_RETENTION.diffStatMaxChars,
        nameStatusMaxChars: DIFF_ARTIFACT_RETENTION.nameStatusMaxChars,
        changedFilesMaxCount: DIFF_ARTIFACT_RETENTION.changedFilesMaxCount
      }
    }
  };
}

function truncateArtifact(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 20))}\n... truncated ...`;
}
