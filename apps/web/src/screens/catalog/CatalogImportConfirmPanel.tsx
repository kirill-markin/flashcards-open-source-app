import type { ReactElement } from "react";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPreviewModel,
} from "../settings/workspace/packages/workspaceImportPresentationModel";

export type CatalogImportConfirmCopy = Readonly<{
  title: string;
  description: string;
  workspaceLabel: string;
  previewLoadingLabel: string;
  advancedTitle: string;
  importTagLabel: string;
  importTagDescription: string;
  importTagValueLabel: string;
  tagsTitle: string;
  confirmActionLabel: string;
  confirmingActionLabel: string;
  backActionLabel: string;
  retryPreviewLabel: string;
}>;

type CatalogImportConfirmPanelProps = Readonly<{
  copy: CatalogImportConfirmCopy;
  workspaceName: string;
  preview: WorkspaceImportPreviewModel | null;
  options: WorkspaceImportOptions;
  isControlDisabled: boolean;
  isPreviewLoading: boolean;
  isBackDisabled: boolean;
  canConfirm: boolean;
  isConfirming: boolean;
  unavailableMessage: string | null;
  errorMessage: string;
  onOptionsChange: (options: WorkspaceImportOptions) => void;
  onConfirm: (options: WorkspaceImportOptions) => void;
  onRetryPreview: (() => void) | null;
  onBack: (() => void) | null;
}>;

type CatalogImportPreviewSummaryProps = Readonly<{
  preview: WorkspaceImportPreviewModel;
}>;

type CatalogImportAdvancedOptionsProps = Readonly<{
  copy: CatalogImportConfirmCopy;
  preview: WorkspaceImportPreviewModel | null;
  options: WorkspaceImportOptions;
  isControlDisabled: boolean;
  onOptionsChange: (options: WorkspaceImportOptions) => void;
}>;

function updateImportTagEnabled(
  options: WorkspaceImportOptions,
  suggestedImportTag: string | null,
  addImportTag: boolean,
): WorkspaceImportOptions {
  return {
    ...options,
    addImportTag,
    importTag: addImportTag && options.importTag.trim() === "" && suggestedImportTag !== null
      ? suggestedImportTag
      : options.importTag,
  };
}

function updateImportTag(options: WorkspaceImportOptions, importTag: string): WorkspaceImportOptions {
  return {
    ...options,
    importTag,
  };
}

function toggleRemovedTag(options: WorkspaceImportOptions, tag: string): WorkspaceImportOptions {
  return {
    ...options,
    removeTags: options.removeTags.includes(tag)
      ? options.removeTags.filter((removedTag) => removedTag !== tag)
      : [...options.removeTags, tag],
  };
}

function CatalogImportPreviewSummary(props: CatalogImportPreviewSummaryProps): ReactElement {
  const { preview } = props;

  return (
    <section className="workspace-import-preview" data-testid="workspace-package-import-preview">
      <div className="workspace-import-preview-stats">
        {preview.statistics.map((statistic) => (
          <div key={statistic.id} className="workspace-import-preview-stat">
            <span className="subtitle">{statistic.label}</span>
            <strong data-testid={statistic.testId}>{statistic.value}</strong>
          </div>
        ))}
      </div>
      {preview.metadataRows.length === 0 ? null : (
        <dl className="workspace-import-preview-metadata" data-testid="workspace-package-import-preview-metadata">
          {preview.metadataRows.map((row) => (
            <div key={row.id} className="workspace-import-preview-metadata-row">
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
    </section>
  );
}

function CatalogImportAdvancedOptions(props: CatalogImportAdvancedOptionsProps): ReactElement {
  const { copy, preview, options, isControlDisabled, onOptionsChange } = props;

  return (
    <details className="catalog-import-advanced" data-testid="catalog-import-advanced">
      <summary>{copy.advancedTitle}</summary>
      <div className="catalog-import-advanced-body">
        <label className="workspace-import-tag-control">
          <input
            type="checkbox"
            checked={options.addImportTag}
            disabled={isControlDisabled}
            data-testid="workspace-package-import-tag-checkbox"
            onChange={(event) => onOptionsChange(updateImportTagEnabled(
              options,
              preview?.suggestedImportTag ?? null,
              event.currentTarget.checked,
            ))}
          />
          <span className="workspace-import-tag-copy">
            <span>{copy.importTagLabel}</span>
            <span className="subtitle">{copy.importTagDescription}</span>
          </span>
        </label>
        {options.addImportTag ? (
          <label className="workspace-import-tag-field" htmlFor="catalog-import-tag-input">
            <span>{copy.importTagValueLabel}</span>
            <input
              id="catalog-import-tag-input"
              type="text"
              value={options.importTag}
              disabled={isControlDisabled}
              data-testid="workspace-package-import-tag-input"
              onChange={(event) => onOptionsChange(updateImportTag(options, event.currentTarget.value))}
            />
          </label>
        ) : null}
        {preview === null || preview.tags.length === 0 ? null : (
          <div className="workspace-import-preview-tags">
            <strong>{copy.tagsTitle}</strong>
            <div className="workspace-import-preview-tag-list">
              {preview.tags.map((tagOption) => (
                <label key={tagOption.tag} className="workspace-import-preview-tag-control">
                  <input
                    type="checkbox"
                    checked={options.removeTags.includes(tagOption.tag)}
                    disabled={isControlDisabled}
                    data-testid="workspace-package-remove-tag-checkbox"
                    data-tag={tagOption.tag}
                    onChange={() => onOptionsChange(toggleRemovedTag(options, tagOption.tag))}
                  />
                  <span>{tagOption.removalLabel}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export function CatalogImportConfirmPanel(props: CatalogImportConfirmPanelProps): ReactElement {
  const {
    copy,
    workspaceName,
    preview,
    options,
    isControlDisabled,
    isPreviewLoading,
    isBackDisabled,
    canConfirm,
    isConfirming,
    unavailableMessage,
    errorMessage,
    onOptionsChange,
    onConfirm,
    onRetryPreview,
    onBack,
  } = props;

  return (
    <section className="content-card invite-panel" data-testid="catalog-import-confirm">
      <strong className="panel-subtitle">{copy.title}</strong>
      <p className="subtitle">{copy.description}</p>
      <p className="catalog-import-target">
        <span className="catalog-import-target-label">{copy.workspaceLabel}</span>
        <strong data-testid="catalog-import-workspace-name">{workspaceName}</strong>
      </p>
      {preview === null ? null : <CatalogImportPreviewSummary preview={preview} />}
      {preview === null && isPreviewLoading ? (
        <p className="subtitle" aria-live="polite" data-testid="catalog-import-preview-loading">
          {copy.previewLoadingLabel}
        </p>
      ) : null}
      <CatalogImportAdvancedOptions
        copy={copy}
        preview={preview}
        options={options}
        isControlDisabled={isControlDisabled}
        onOptionsChange={onOptionsChange}
      />
      <div className="catalog-import-actions">
        <button
          className="primary-btn"
          type="button"
          disabled={!canConfirm}
          data-testid="workspace-package-import-confirm-button"
          onClick={() => onConfirm(options)}
        >
          {isConfirming ? copy.confirmingActionLabel : copy.confirmActionLabel}
        </button>
        {onBack === null ? null : (
          <button
            className="ghost-btn catalog-import-back-button"
            type="button"
            disabled={isBackDisabled}
            data-testid="catalog-import-back"
            onClick={onBack}
          >
            {copy.backActionLabel}
          </button>
        )}
      </div>
      {unavailableMessage === null ? null : (
        <p className="subtitle" data-testid="workspace-package-import-unavailable">{unavailableMessage}</p>
      )}
      {errorMessage === "" ? null : (
        <p className="error-banner" role="alert" data-testid="workspace-import-error">{errorMessage}</p>
      )}
      {onRetryPreview === null ? null : (
        <div className="catalog-import-actions">
          <button
            className="ghost-btn"
            type="button"
            data-testid="catalog-import-preview-retry"
            onClick={onRetryPreview}
          >
            {copy.retryPreviewLabel}
          </button>
        </div>
      )}
    </section>
  );
}
