import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  confirmWorkspacePackageImport,
  downloadWorkspacePackageExport,
  previewWorkspacePackageExport,
  previewWorkspacePackageImport,
} from "../../../api";
import { useAppData } from "../../../appData";
import { requireCloudInstallationId } from "../../../appData/sync/local/syncCloudSettings";
import { useAppErrorDialog } from "../../../appError/AppErrorContext";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type {
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportRequest,
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportPreviewResponse,
} from "../../../types";
import { exportWorkspaceCardsCsv, triggerBlobDownload } from "../../../workspaceExport";
import { SettingsShell } from "../SettingsShared";

type PackageMetadataRow = Readonly<{
  label: string;
  value: string;
  href: string | null;
}>;

type PackageExportPreviewIdentity = Readonly<{
  workspaceId: string;
}>;

type PackageImportPreviewIdentity = Readonly<{
  workspaceId: string;
  installationId: string;
}>;

type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;

function buildDefaultWorkspacePackageExportPreviewRequest(): WorkspacePackageExportRequest {
  return {
    selection: {
      kind: "allActiveCards",
    },
    tagPolicy: {
      additionalRemovedTags: [],
    },
    packageMetadata: {
      label: null,
      author: null,
      comment: null,
      createdAt: null,
      sourceUrl: null,
    },
  };
}

function buildWorkspacePackageExportDownloadRequest(
  preview: WorkspacePackageExportPreviewResponse,
  removedTags: ReadonlyArray<string>,
): WorkspacePackageExportRequest {
  return {
    selection: {
      kind: "allActiveCards",
    },
    tagPolicy: {
      additionalRemovedTags: removedTags,
    },
    packageMetadata: {
      label: preview.defaultPackageMetadata.label,
      author: preview.defaultPackageMetadata.author ?? null,
      comment: preview.defaultPackageMetadata.comment ?? null,
      createdAt: preview.defaultPackageMetadata.createdAt,
      sourceUrl: preview.defaultPackageMetadata.sourceUrl ?? null,
    },
  };
}

function buildSafeMetadataHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function formatPackageMetadataCreatedAt(
  value: string,
  formatDateTimeValue: (dateValue: Date) => string,
): string {
  const dateValue = new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    return value;
  }

  return formatDateTimeValue(dateValue);
}

function formatApproximateBytes(byteCount: number, formatNumberValue: NumberFormatter): string {
  const bytesPerKilobyte = 1024;
  const bytesPerMegabyte = bytesPerKilobyte * 1024;
  const bytesPerGigabyte = bytesPerMegabyte * 1024;

  if (byteCount < bytesPerKilobyte) {
    return `${formatNumberValue(byteCount)} B`;
  }

  if (byteCount < bytesPerMegabyte) {
    return `${formatNumberValue(byteCount / bytesPerKilobyte, { maximumFractionDigits: 1 })} KB`;
  }

  if (byteCount < bytesPerGigabyte) {
    return `${formatNumberValue(byteCount / bytesPerMegabyte, { maximumFractionDigits: 1 })} MB`;
  }

  return `${formatNumberValue(byteCount / bytesPerGigabyte, { maximumFractionDigits: 1 })} GB`;
}

export function WorkspaceExportScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, isSessionVerified, refreshLocalData, session } = useAppData();
  const { showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime, formatNumber } = useI18n();
  const packageImportInputRef = useRef<HTMLInputElement | null>(null);
  const [isCsvExporting, setIsCsvExporting] = useState<boolean>(false);
  const [isPackageExporting, setIsPackageExporting] = useState<boolean>(false);
  const [isPackageExportPreviewing, setIsPackageExportPreviewing] = useState<boolean>(false);
  const [isPackagePreviewing, setIsPackagePreviewing] = useState<boolean>(false);
  const [isPackageImporting, setIsPackageImporting] = useState<boolean>(false);
  const [packageExportPreview, setPackageExportPreview] = useState<WorkspacePackageExportPreviewResponse | null>(null);
  const [packageExportPreviewIdentity, setPackageExportPreviewIdentity] = useState<PackageExportPreviewIdentity | null>(null);
  const [packageExportRemoveTags, setPackageExportRemoveTags] = useState<ReadonlyArray<string>>([]);
  const [shouldTagPackageImport, setShouldTagPackageImport] = useState<boolean>(true);
  const [packageImportFile, setPackageImportFile] = useState<File | null>(null);
  const [packageImportPreview, setPackageImportPreview] = useState<WorkspacePackageImportPreviewResponse | null>(null);
  const [packageImportPreviewIdentity, setPackageImportPreviewIdentity] = useState<PackageImportPreviewIdentity | null>(null);
  const [packageImportTag, setPackageImportTag] = useState<string>("");
  const [packageImportRemoveTags, setPackageImportRemoveTags] = useState<ReadonlyArray<string>>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");
  const isPackageExportBusy = isPackageExportPreviewing || isPackageExporting;
  const isPackageImportBusy = isPackagePreviewing || isPackageImporting;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const isPackageExportPreviewCurrent = packageExportPreview !== null
    && packageExportPreviewIdentity !== null
    && activeWorkspaceId !== null
    && packageExportPreviewIdentity.workspaceId === activeWorkspaceId;
  const currentPackageExportPreview = isPackageExportPreviewCurrent ? packageExportPreview : null;
  const currentInstallationId = cloudSettings?.cloudState === "linked" && cloudSettings.installationId.trim() !== ""
    ? cloudSettings.installationId
    : null;
  const isPackageImportAvailable = activeWorkspace !== null && isSessionVerified && currentInstallationId !== null;
  const isPackageImportPreviewCurrent = packageImportPreview !== null
    && packageImportFile !== null
    && packageImportPreviewIdentity !== null
    && isPackageImportAvailable
    && packageImportPreviewIdentity.workspaceId === activeWorkspaceId
    && packageImportPreviewIdentity.installationId === currentInstallationId;
  const isPackageImportControlDisabled = !isPackageImportAvailable || isPackageImportBusy;
  const packageExportMetadataRows: ReadonlyArray<PackageMetadataRow> = currentPackageExportPreview === null
    ? []
    : [
      {
        label: t("workspaceExport.previewMetadataLabel"),
        value: currentPackageExportPreview.defaultPackageMetadata.label,
        href: null,
      },
      currentPackageExportPreview.defaultPackageMetadata.author === undefined ? null : {
        label: t("workspaceExport.previewMetadataAuthor"),
        value: currentPackageExportPreview.defaultPackageMetadata.author,
        href: null,
      },
      currentPackageExportPreview.defaultPackageMetadata.comment === undefined ? null : {
        label: t("workspaceExport.previewMetadataComment"),
        value: currentPackageExportPreview.defaultPackageMetadata.comment,
        href: null,
      },
      {
        label: t("workspaceExport.previewMetadataCreatedAt"),
        value: formatPackageMetadataCreatedAt(currentPackageExportPreview.defaultPackageMetadata.createdAt, formatDateTime),
        href: null,
      },
      currentPackageExportPreview.defaultPackageMetadata.sourceUrl === undefined ? null : {
        label: t("workspaceExport.previewMetadataSourceUrl"),
        value: currentPackageExportPreview.defaultPackageMetadata.sourceUrl,
        href: buildSafeMetadataHttpUrl(currentPackageExportPreview.defaultPackageMetadata.sourceUrl),
      },
    ].filter((row): row is PackageMetadataRow => row !== null);
  const packageImportMetadataRows: ReadonlyArray<PackageMetadataRow> = packageImportPreview === null
    ? []
    : [
      packageImportPreview.packageMetadata.label === null ? null : {
        label: t("workspaceExport.previewMetadataLabel"),
        value: packageImportPreview.packageMetadata.label,
        href: null,
      },
      packageImportPreview.packageMetadata.author === null ? null : {
        label: t("workspaceExport.previewMetadataAuthor"),
        value: packageImportPreview.packageMetadata.author,
        href: null,
      },
      packageImportPreview.packageMetadata.comment === null ? null : {
        label: t("workspaceExport.previewMetadataComment"),
        value: packageImportPreview.packageMetadata.comment,
        href: null,
      },
      packageImportPreview.packageMetadata.createdAt === null ? null : {
        label: t("workspaceExport.previewMetadataCreatedAt"),
        value: formatPackageMetadataCreatedAt(packageImportPreview.packageMetadata.createdAt, formatDateTime),
        href: null,
      },
      packageImportPreview.packageMetadata.sourceUrl === null ? null : {
        label: t("workspaceExport.previewMetadataSourceUrl"),
        value: packageImportPreview.packageMetadata.sourceUrl,
        href: buildSafeMetadataHttpUrl(packageImportPreview.packageMetadata.sourceUrl),
      },
    ].filter((row): row is PackageMetadataRow => row !== null);

  function captureWorkspaceOperationError(error: unknown, operation: "workspace_export" | "workspace_import"): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: activeWorkspace?.workspaceId ?? null,
    });
  }

  function resetPackageImportPreview(): void {
    setPackageImportFile(null);
    setPackageImportPreview(null);
    setPackageImportPreviewIdentity(null);
    setPackageImportTag("");
    setPackageImportRemoveTags([]);
  }

  function resetPackageExportPreview(): void {
    setPackageExportPreview(null);
    setPackageExportPreviewIdentity(null);
    setPackageExportRemoveTags([]);
  }

  useEffect(() => {
    if (packageExportPreviewIdentity === null) {
      return;
    }

    if (packageExportPreviewIdentity.workspaceId !== activeWorkspaceId) {
      resetPackageExportPreview();
    }
  }, [activeWorkspaceId, packageExportPreviewIdentity]);

  useEffect(() => {
    if (packageImportPreviewIdentity === null) {
      return;
    }

    if (
      packageImportPreviewIdentity.workspaceId !== activeWorkspaceId
      || packageImportPreviewIdentity.installationId !== currentInstallationId
    ) {
      resetPackageImportPreview();
    }
  }, [activeWorkspaceId, currentInstallationId, packageImportPreviewIdentity]);

  async function exportCsv(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsCsvExporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await exportWorkspaceCardsCsv({
        workspaceId: activeWorkspace.workspaceId,
        workspaceName: activeWorkspace.name,
        now: new Date(),
        document: window.document,
        urlApi: URL,
      });
      setSuccessMessage(t("workspaceExport.success"));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_export");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsCsvExporting(false);
    }
  }

  async function previewPackageExport(): Promise<void> {
    if (activeWorkspace === null) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsPackageExportPreviewing(true);
    setErrorMessage("");
    setSuccessMessage("");
    resetPackageExportPreview();

    try {
      const preview = await previewWorkspacePackageExport(
        activeWorkspace.workspaceId,
        buildDefaultWorkspacePackageExportPreviewRequest(),
      );
      setPackageExportPreview(preview);
      setPackageExportPreviewIdentity({
        workspaceId: activeWorkspace.workspaceId,
      });
      setPackageExportRemoveTags(preview.tagsSelectedForRemoval.map((tagCount) => tagCount.tag));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_export");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackageExportPreviewing(false);
    }
  }

  async function downloadPackageExport(): Promise<void> {
    const currentPreview = currentPackageExportPreview;
    if (activeWorkspace === null || currentPreview === null) {
      resetPackageExportPreview();
      setErrorMessage(t("workspaceExport.packageExportPreviewRequired"));
      setSuccessMessage("");
      return;
    }

    setIsPackageExporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const result = await downloadWorkspacePackageExport(
        activeWorkspace.workspaceId,
        buildWorkspacePackageExportDownloadRequest(currentPreview, packageExportRemoveTags),
      );
      triggerBlobDownload({
        blob: result.blob,
        filename: result.filename,
        document: window.document,
        urlApi: URL,
      });
      setSuccessMessage(t("workspaceExport.packageExportSuccess"));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_export");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackageExporting(false);
    }
  }

  async function previewPackageImportFile(file: File): Promise<void> {
    if (!isPackageImportAvailable) {
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    setIsPackagePreviewing(true);
    setErrorMessage("");
    setSuccessMessage("");
    resetPackageImportPreview();

    try {
      const preview = await previewWorkspacePackageImport(activeWorkspace.workspaceId, file);
      setPackageImportFile(file);
      setPackageImportPreview(preview);
      setPackageImportPreviewIdentity({
        workspaceId: activeWorkspace.workspaceId,
        installationId: currentInstallationId,
      });
      setShouldTagPackageImport(preview.defaultOptions.addImportTag);
      setPackageImportTag(preview.defaultOptions.suggestedImportTag);
      setPackageImportRemoveTags([...preview.defaultOptions.removedTags]);
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_import");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackagePreviewing(false);
      if (packageImportInputRef.current !== null) {
        packageImportInputRef.current.value = "";
      }
    }
  }

  async function confirmPackageImport(): Promise<void> {
    if (!isPackageImportAvailable) {
      resetPackageImportPreview();
      setErrorMessage(t("workspaceExport.workspaceUnavailable"));
      setSuccessMessage("");
      return;
    }

    if (!isPackageImportPreviewCurrent) {
      resetPackageImportPreview();
      setErrorMessage(t("workspaceExport.packagePreviewRequired"));
      setSuccessMessage("");
      return;
    }

    setIsPackageImporting(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const importId = crypto.randomUUID().toLowerCase();
      const importedAt = new Date().toISOString();
      const options: WorkspacePackageImportConfirmOptions = {
        addImportTag: shouldTagPackageImport,
        importTag: packageImportTag,
        removeTags: packageImportRemoveTags,
        importedAt,
        importId,
        clientUpdatedAt: importedAt,
        lastModifiedByReplicaId: requireCloudInstallationId(cloudSettings),
        operationIdPrefix: importId,
      };
      const result = await confirmWorkspacePackageImport(activeWorkspace.workspaceId, packageImportFile, options);

      resetPackageImportPreview();
      await refreshLocalData();
      setSuccessMessage(result.summary.importTag === null
        ? t("workspaceExport.packageImportSuccess", { count: result.summary.cardCount })
        : t("workspaceExport.packageImportSuccessWithTag", {
          count: result.summary.cardCount,
          tag: result.summary.importTag,
        }));
    } catch (error) {
      const wasCaptured = captureWorkspaceOperationError(error, "workspace_import");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setIsPackageImporting(false);
    }
  }

  function handlePackageImportInputChange(): void {
    const file = packageImportInputRef.current?.files?.[0] ?? null;
    if (file === null) {
      return;
    }

    void previewPackageImportFile(file);
  }

  function togglePackageImportRemovedTag(tag: string): void {
    setPackageImportRemoveTags((currentTags) => (
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    ));
  }

  function togglePackageExportRemovedTag(tag: string): void {
    setPackageExportRemoveTags((currentTags) => (
      currentTags.includes(tag)
        ? currentTags.filter((currentTag) => currentTag !== tag)
        : [...currentTags, tag]
    ));
  }

  return (
    <SettingsShell
      title={t("workspaceExport.title")}
      subtitle={t("workspaceExport.subtitle")}
      activeTab="workspace"
    >
      <section className="settings-group">
        <h2 className="panel-subtitle">{t("workspaceExport.formatsTitle")}</h2>
        <article className="content-card workspace-export-format-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("workspaceExport.packageTitle")}</strong>
            <p className="subtitle">{t("workspaceExport.packageDescription")}</p>
          </div>
          {currentPackageExportPreview === null ? null : (
            <section className="workspace-import-preview" data-testid="workspace-package-export-preview">
              <div className="workspace-import-preview-stats">
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.previewCardsLabel")}</span>
                  <strong data-testid="workspace-package-export-preview-card-count">
                    {formatNumber(currentPackageExportPreview.selectedCardCount)}
                  </strong>
                </div>
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.previewReferencedMediaLabel")}</span>
                  <strong data-testid="workspace-package-export-preview-referenced-media-count">
                    {formatNumber(currentPackageExportPreview.referencedMediaCount)}
                  </strong>
                </div>
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.exportPreviewReferencedMediaBytesLabel")}</span>
                  <strong data-testid="workspace-package-export-preview-referenced-media-bytes">
                    {formatApproximateBytes(currentPackageExportPreview.approximateReferencedMediaBytes, formatNumber)}
                  </strong>
                </div>
              </div>
              {packageExportMetadataRows.length === 0 ? null : (
                <dl className="workspace-import-preview-metadata" data-testid="workspace-package-export-preview-metadata">
                  {packageExportMetadataRows.map((row) => (
                    <div key={row.label} className="workspace-import-preview-metadata-row">
                      <dt>{row.label}</dt>
                      <dd>
                        {row.href === null ? row.value : (
                          <a href={row.href} target="_blank" rel="noreferrer">{row.value}</a>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {currentPackageExportPreview.availableTagCounts.length === 0 ? null : (
                <div className="workspace-import-preview-tags">
                  <strong>{t("workspaceExport.exportPreviewTagsTitle")}</strong>
                  <div className="workspace-import-preview-tag-list">
                    {currentPackageExportPreview.availableTagCounts.map((tagCount) => (
                      <label key={tagCount.tag} className="workspace-import-preview-tag-control">
                        <input
                          type="checkbox"
                          checked={packageExportRemoveTags.includes(tagCount.tag)}
                          disabled={isPackageExportBusy}
                          data-testid="workspace-package-export-remove-tag-checkbox"
                          data-tag={tagCount.tag}
                          onChange={() => togglePackageExportRemovedTag(tagCount.tag)}
                        />
                        <span>{t("workspaceExport.exportPreviewRemoveTagLabel", {
                          tag: tagCount.tag,
                          count: tagCount.cardsCount,
                        })}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          <label className="workspace-import-tag-control">
            <input
              type="checkbox"
              checked={shouldTagPackageImport}
              disabled={isPackageImportControlDisabled}
              data-testid="workspace-package-import-tag-checkbox"
              onChange={(event) => setShouldTagPackageImport(event.currentTarget.checked)}
            />
            <span className="workspace-import-tag-copy">
              <span>{t("workspaceExport.importTagLabel")}</span>
              <span className="subtitle">{t("workspaceExport.importTagDescription")}</span>
            </span>
          </label>
          <input
            ref={packageImportInputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isPackageImportControlDisabled}
            data-testid="workspace-package-import-file-input"
            style={{ display: "none" }}
            onChange={handlePackageImportInputChange}
          />
          {packageImportPreview === null ? null : (
            <section className="workspace-import-preview" data-testid="workspace-package-import-preview">
              <div className="workspace-import-preview-stats">
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.previewCardsLabel")}</span>
                  <strong data-testid="workspace-package-import-preview-card-count">{formatNumber(packageImportPreview.cardCount)}</strong>
                </div>
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.previewReferencedMediaLabel")}</span>
                  <strong data-testid="workspace-package-import-preview-referenced-media-count">{formatNumber(packageImportPreview.referencedMediaCount)}</strong>
                </div>
                <div className="workspace-import-preview-stat">
                  <span className="subtitle">{t("workspaceExport.previewPackageMediaLabel")}</span>
                  <strong data-testid="workspace-package-import-preview-package-media-count">{formatNumber(packageImportPreview.packageMediaFileCount)}</strong>
                </div>
              </div>
              {shouldTagPackageImport && packageImportTag !== "" ? (
                <p className="subtitle" data-testid="workspace-package-import-preview-import-tag">
                  {t("workspaceExport.previewImportTag", { tag: packageImportTag })}
                </p>
              ) : null}
              {packageImportMetadataRows.length === 0 ? null : (
                <dl className="workspace-import-preview-metadata" data-testid="workspace-package-import-preview-metadata">
                  {packageImportMetadataRows.map((row) => (
                    <div key={row.label} className="workspace-import-preview-metadata-row">
                      <dt>{row.label}</dt>
                      <dd>
                        {row.href === null ? row.value : (
                          <a href={row.href} target="_blank" rel="noreferrer">{row.value}</a>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {packageImportPreview.warnings.length === 0 ? null : (
                <div className="workspace-import-preview-warnings" data-testid="workspace-package-import-preview-warnings">
                  <strong>{t("workspaceExport.previewWarningsTitle")}</strong>
                  <ul>
                    {packageImportPreview.warnings.map((warning) => (
                      <li key={`${warning.code}:${warning.mediaPath}:${warning.message}`}>
                        {warning.mediaPath === ""
                          ? warning.message
                          : t("workspaceExport.previewWarningWithPath", {
                            message: warning.message,
                            path: warning.mediaPath,
                          })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {packageImportPreview.tagCounts.length === 0 ? null : (
                <div className="workspace-import-preview-tags">
                  <strong>{t("workspaceExport.previewTagsTitle")}</strong>
                  <div className="workspace-import-preview-tag-list">
                    {packageImportPreview.tagCounts.map((tagCount) => (
                      <label key={tagCount.tag} className="workspace-import-preview-tag-control">
                        <input
                          type="checkbox"
                          checked={packageImportRemoveTags.includes(tagCount.tag)}
                          disabled={isPackageImportControlDisabled}
                          data-testid="workspace-package-remove-tag-checkbox"
                          data-tag={tagCount.tag}
                          onChange={() => togglePackageImportRemovedTag(tagCount.tag)}
                        />
                        <span>{t("workspaceExport.previewRemoveTagLabel", {
                          tag: tagCount.tag,
                          count: tagCount.cardsCount,
                        })}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
          <div className="workspace-export-actions">
            <button
              className="primary-btn"
              type="button"
              disabled={activeWorkspace === null || isPackageExportBusy}
              data-testid="workspace-package-export-button"
              onClick={() => void previewPackageExport()}
            >
              {isPackageExportPreviewing ? t("workspaceExport.packagePreviewing") : t("workspaceExport.packageExportPreviewButton")}
            </button>
            {currentPackageExportPreview === null ? null : (
              <button
                className="primary-btn"
                type="button"
                disabled={isPackageExportBusy}
                data-testid="workspace-package-export-confirm-button"
                onClick={() => void downloadPackageExport()}
              >
                {isPackageExporting ? t("workspaceExport.packageExporting") : t("workspaceExport.packageExportConfirmButton")}
              </button>
            )}
            <button
              className="ghost-btn"
              type="button"
              disabled={isPackageImportControlDisabled}
              data-testid="workspace-package-import-button"
              onClick={() => packageImportInputRef.current?.click()}
            >
              {isPackagePreviewing ? t("workspaceExport.packagePreviewing") : t("workspaceExport.packageImportButton")}
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={!isPackageImportPreviewCurrent || isPackageImportBusy}
              data-testid="workspace-package-import-confirm-button"
              onClick={() => void confirmPackageImport()}
            >
              {isPackageImporting ? t("workspaceExport.packageImporting") : t("workspaceExport.packageConfirmButton")}
            </button>
          </div>
          {activeWorkspace !== null && !isPackageImportAvailable ? (
            <p className="subtitle" data-testid="workspace-package-import-unavailable">
              {isSessionVerified ? t("workspaceExport.workspaceUnavailable") : t("loading.restoringSession")}
            </p>
          ) : null}
        </article>
        <article className="content-card workspace-export-format-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("workspaceExport.csvTitle")}</strong>
            <p className="subtitle">{t("workspaceExport.csvDescription")}</p>
          </div>
          <button
            className="primary-btn"
            type="button"
            disabled={isCsvExporting}
            data-testid="workspace-csv-export-button"
            onClick={() => void exportCsv()}
          >
            {isCsvExporting ? t("workspaceExport.exporting") : t("workspaceExport.exportButton")}
          </button>
        </article>
        {errorMessage !== "" ? <p className="error-banner" role="alert" data-testid="workspace-export-error">{errorMessage}</p> : null}
        {successMessage !== "" ? <p className="subtitle" data-testid="workspace-export-success">{successMessage}</p> : null}
      </section>
    </SettingsShell>
  );
}
