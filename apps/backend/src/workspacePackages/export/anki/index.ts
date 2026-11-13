import { loadWorkspacePackageExport, type WorkspacePackageExportPackageInput } from "../exportPackage";
import { defaultAnkiExportDeckName } from "./ankiCollection";
import { createAnkiWorkspacePackageDownload } from "./ankiDownload";
import { buildAnkiWorkspacePackage } from "./ankiPackage";
import { ankiExportMaxInlineBytes, type AnkiWorkspacePackage } from "./contract";

export type AnkiWorkspacePackageExportOptions = Readonly<{
  loadWorkspacePackageExportFn?: typeof loadWorkspacePackageExport;
  createAnkiWorkspacePackageDownloadFn?: typeof createAnkiWorkspacePackageDownload;
}>;

type AnkiWorkspacePackageDelivery = Readonly<{
  archive: AnkiWorkspacePackage;
  downloadUrl?: string;
}>;

export function createAnkiWorkspacePackageExporter(options: AnkiWorkspacePackageExportOptions) {
  const loadWorkspacePackageExportFn = options.loadWorkspacePackageExportFn ?? loadWorkspacePackageExport;
  const createAnkiWorkspacePackageDownloadFn = options.createAnkiWorkspacePackageDownloadFn ?? createAnkiWorkspacePackageDownload;

  return async (
    userId: string,
    workspaceId: string,
    input: WorkspacePackageExportPackageInput,
  ): Promise<AnkiWorkspacePackageDelivery> => {
    const exported = await loadWorkspacePackageExportFn(userId, workspaceId, {
      ...input,
      packageMetadata: { ...input.packageMetadata, label: input.packageMetadata.label ?? defaultAnkiExportDeckName },
    });
    const archive = buildAnkiWorkspacePackage(workspaceId, exported, input.generatedAt);
    if (archive.bytes.byteLength <= ankiExportMaxInlineBytes) {
      return { archive };
    }

    const downloadUrl = await createAnkiWorkspacePackageDownloadFn(workspaceId, archive);
    return { archive, downloadUrl };
  };
}
