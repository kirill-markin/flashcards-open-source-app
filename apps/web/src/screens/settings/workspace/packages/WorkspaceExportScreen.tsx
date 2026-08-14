import { useEffect, useState, type ReactElement } from "react";
import {
  downloadWorkspacePackageExport,
  previewWorkspacePackageExport,
} from "../../../../api";
import { useAppData } from "../../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
import { useI18n } from "../../../../i18n";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import type {
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportRequest,
} from "../../../../types";
import { SettingsShell } from "../../SettingsShared";

type PackageMetadataRow = Readonly<{
  label: string;
  value: string;
  href: string | null;
}>;

type PackageExportPreviewIdentity = Readonly<{
  workspaceId: string;
}>;

type NumberFormatter = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;

type WorkspaceExportUrlApi = Readonly<{
  createObjectURL: (object: Blob) => string;
  revokeObjectURL: (url: string) => void;
}>;

type TriggerBlobDownloadParams = Readonly<{
  blob: Blob;
  filename: string;
  document: Document;
  urlApi: WorkspaceExportUrlApi;
}>;

const workspacePackageGeneratedImportTagPrefix = "import:";

function triggerBlobDownload(params: TriggerBlobDownloadParams): void {
  const { blob, filename, document, urlApi } = params;
  if (document.body === null) {
    throw new Error(`Document body is unavailable for workspace download: filename=${filename}`);
  }

  const objectUrl = urlApi.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  urlApi.revokeObjectURL(objectUrl);
}

function isWorkspacePackageGeneratedImportTag(tag: string): boolean {
  return tag.startsWith(workspacePackageGeneratedImportTagPrefix);
}

function buildWorkspacePackageExportSelection(
  selectedCardTags: ReadonlyArray<string>,
): WorkspacePackageExportRequest["selection"] {
  if (selectedCardTags.length === 0) {
    return {
      kind: "allActiveCards",
    };
  }

  return {
    kind: "tagFilters",
    includeTags: selectedCardTags,
    excludeTags: [],
  };
}

function buildWorkspacePackageExportPreviewRequest(
  selectedCardTags: ReadonlyArray<string>,
): WorkspacePackageExportRequest {
  return {
    selection: buildWorkspacePackageExportSelection(selectedCardTags),
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
  selectedCardTags: ReadonlyArray<string>,
  includedTags: ReadonlyArray<string>,
): WorkspacePackageExportRequest {
  const includedTagSet = new Set(includedTags);
  const additionalRemovedTags = preview.availableTagCounts
    .map((tagCount) => tagCount.tag)
    .filter((tag) => !isWorkspacePackageGeneratedImportTag(tag) && !includedTagSet.has(tag));

  return {
    selection: buildWorkspacePackageExportSelection(selectedCardTags),
    tagPolicy: {
      additionalRemovedTags,
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

function buildWorkspacePackageIncludedTags(
  preview: WorkspacePackageExportPreviewResponse,
): ReadonlyArray<string> {
  return preview.availableTagCounts
    .map((tagCount) => tagCount.tag)
    .filter((tag) => !isWorkspacePackageGeneratedImportTag(tag));
}

function mergeWorkspacePackageExportTagCounts(
  baseTagCounts: ReadonlyArray<WorkspacePackageExportPreviewResponse["availableTagCounts"][number]>,
  nextTagCounts: ReadonlyArray<WorkspacePackageExportPreviewResponse["availableTagCounts"][number]>,
): ReadonlyArray<WorkspacePackageExportPreviewResponse["availableTagCounts"][number]> {
  const mergedTagCounts: Array<WorkspacePackageExportPreviewResponse["availableTagCounts"][number]> = [];
  const mergedTags = new Set<string>();

  [...baseTagCounts, ...nextTagCounts].forEach((tagCount) => {
    if (mergedTags.has(tagCount.tag)) {
      return;
    }

    mergedTags.add(tagCount.tag);
    mergedTagCounts.push(tagCount);
  });

  return mergedTagCounts;
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
  const { activeWorkspace, cloudSettings, session } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t, formatDateTime, formatNumber } = useI18n();
  const [isPackageExporting, setIsPackageExporting] = useState<boolean>(false);
  const [isPackageExportPreviewing, setIsPackageExportPreviewing] = useState<boolean>(false);
  const [packageExportPreview, setPackageExportPreview] = useState<WorkspacePackageExportPreviewResponse | null>(null);
  const [packageExportPreviewIdentity, setPackageExportPreviewIdentity] = useState<PackageExportPreviewIdentity | null>(null);
  const [packageExportSelectedCardTags, setPackageExportSelectedCardTags] = useState<ReadonlyArray<string>>([]);
  const [packageExportCardSelectionTagCounts, setPackageExportCardSelectionTagCounts] = useState<WorkspacePackageExportPreviewResponse["availableTagCounts"]>([]);
  const [packageExportIncludedTags, setPackageExportIncludedTags] = useState<ReadonlyArray<string>>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const technicalErrorMessage = t("appError.technicalError.message");
  const isPackageExportBusy = isPackageExportPreviewing || isPackageExporting;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const isPackageExportPreviewCurrent = packageExportPreview !== null
    && packageExportPreviewIdentity !== null
    && activeWorkspaceId !== null
    && packageExportPreviewIdentity.workspaceId === activeWorkspaceId;
  const currentPackageExportPreview = isPackageExportPreviewCurrent ? packageExportPreview : null;
  const packageExportIncludedTagCounts = currentPackageExportPreview === null
    ? []
    : currentPackageExportPreview.availableTagCounts.filter((tagCount) => !isWorkspacePackageGeneratedImportTag(tagCount.tag));
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

  function captureWorkspaceExportError(error: unknown): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation: "workspace_export",
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: activeWorkspace?.workspaceId ?? null,
    });
  }

  function resetPackageExportPreview(): void {
    setPackageExportPreview(null);
    setPackageExportPreviewIdentity(null);
    setPackageExportIncludedTags([]);
  }

  function resetPackageExportState(): void {
    resetPackageExportPreview();
    setPackageExportSelectedCardTags([]);
    setPackageExportCardSelectionTagCounts([]);
  }

  useEffect(() => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    if (packageExportPreviewIdentity === null) {
      return;
    }

    if (packageExportPreviewIdentity.workspaceId !== activeWorkspaceId) {
      resetPackageExportState();
    }
  }, [activeWorkspaceId, indexedDbOpenRecoveryState, packageExportPreviewIdentity]);

  async function previewPackageExportWithSelection(selectedCardTags: ReadonlyArray<string>): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
        buildWorkspacePackageExportPreviewRequest(selectedCardTags),
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      setPackageExportPreview(preview);
      setPackageExportPreviewIdentity({
        workspaceId: activeWorkspace.workspaceId,
      });
      setPackageExportCardSelectionTagCounts((currentTagCounts) => (
        selectedCardTags.length === 0
          ? preview.availableTagCounts
          : mergeWorkspacePackageExportTagCounts(currentTagCounts, preview.availableTagCounts)
      ));
      setPackageExportIncludedTags(buildWorkspacePackageIncludedTags(preview));
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const wasCaptured = captureWorkspaceExportError(error);
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsPackageExportPreviewing(false);
      }
    }
  }

  async function previewPackageExport(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    await previewPackageExportWithSelection(packageExportSelectedCardTags);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
  }

  async function downloadPackageExport(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
        buildWorkspacePackageExportDownloadRequest(currentPreview, packageExportSelectedCardTags, packageExportIncludedTags),
      );
      indexedDbOpenRecoveryState.throwIfFailed();
      triggerBlobDownload({
        blob: result.blob,
        filename: result.filename,
        document: window.document,
        urlApi: URL,
      });
      setSuccessMessage(t("workspaceExport.packageExportSuccess"));
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      const wasCaptured = captureWorkspaceExportError(error);
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsPackageExporting(false);
      }
    }
  }

  function selectAllPackageExportCards(): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setPackageExportSelectedCardTags([]);
    void previewPackageExportWithSelection([]);
  }

  function togglePackageExportCardSelectionTag(tag: string): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const selectedCardTags = packageExportSelectedCardTags.includes(tag)
      ? packageExportSelectedCardTags.filter((currentTag) => currentTag !== tag)
      : [...packageExportSelectedCardTags, tag];

    setPackageExportSelectedCardTags(selectedCardTags);
    void previewPackageExportWithSelection(selectedCardTags);
  }

  function togglePackageExportIncludedTag(tag: string): void {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setPackageExportIncludedTags((currentTags) => (
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
              {packageExportCardSelectionTagCounts.length === 0 ? null : (
                <div className="workspace-import-preview-tags">
                  <strong>{t("workspaceExport.cardSelectionTitle")}</strong>
                  <p className="subtitle">{t("workspaceExport.cardSelectionDescription")}</p>
                  <div className="workspace-import-preview-tag-list">
                    <label className="workspace-import-preview-tag-control">
                      <input
                        type="radio"
                        checked={packageExportSelectedCardTags.length === 0}
                        disabled={isPackageExportBusy}
                        data-testid="workspace-package-export-all-cards-radio"
                        onChange={selectAllPackageExportCards}
                      />
                      <span>{t("workspaceExport.cardSelectionAllCardsLabel")}</span>
                    </label>
                    {packageExportCardSelectionTagCounts.map((tagCount) => (
                      <label key={tagCount.tag} className="workspace-import-preview-tag-control">
                        <input
                          type="checkbox"
                          checked={packageExportSelectedCardTags.includes(tagCount.tag)}
                          disabled={isPackageExportBusy}
                          data-testid="workspace-package-export-card-selection-tag-checkbox"
                          data-tag={tagCount.tag}
                          onChange={() => togglePackageExportCardSelectionTag(tagCount.tag)}
                        />
                        <span>{t("workspaceExport.cardSelectionTagLabel", {
                          tag: tagCount.tag,
                          count: tagCount.cardsCount,
                        })}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {packageExportIncludedTagCounts.length === 0 ? null : (
                <div className="workspace-import-preview-tags">
                  <strong>{t("workspaceExport.includedTagsTitle")}</strong>
                  <p className="subtitle">{t("workspaceExport.includedTagsDescription")}</p>
                  <div className="workspace-import-preview-tag-list">
                    {packageExportIncludedTagCounts.map((tagCount) => (
                      <label key={tagCount.tag} className="workspace-import-preview-tag-control">
                        <input
                          type="checkbox"
                          checked={packageExportIncludedTags.includes(tagCount.tag)}
                          disabled={isPackageExportBusy}
                          data-testid="workspace-package-export-included-tag-checkbox"
                          data-tag={tagCount.tag}
                          onChange={() => togglePackageExportIncludedTag(tagCount.tag)}
                        />
                        <span>{t("workspaceExport.includedTagLabel", {
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
          </div>
        </article>
        {errorMessage !== "" ? <p className="error-banner" role="alert" data-testid="workspace-export-error">{errorMessage}</p> : null}
        {successMessage !== "" ? <p className="subtitle" data-testid="workspace-export-success">{successMessage}</p> : null}
      </section>
    </SettingsShell>
  );
}
