import { Fragment, type ReactElement } from "react";
import type {
  WorkspaceImportOptions,
  WorkspaceImportPresentationCopy,
  WorkspaceImportPreviewModel,
} from "./workspaceImportPresentationModel";

type WorkspaceImportPresentationProps = Readonly<{
  copy: WorkspaceImportPresentationCopy;
  preview: WorkspaceImportPreviewModel | null;
  options: WorkspaceImportOptions;
  isControlDisabled: boolean;
  canConfirm: boolean;
  isConfirming: boolean;
  unavailableMessage: string | null;
  errorMessage: string;
  successMessage: string;
  onSelect: () => void;
  onOptionsChange: (options: WorkspaceImportOptions) => void;
  onConfirm: (options: WorkspaceImportOptions) => void;
}>;

type WorkspaceImportPreviewProps = Readonly<{
  copy: WorkspaceImportPresentationCopy;
  preview: WorkspaceImportPreviewModel;
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

function WorkspaceImportPreview(props: WorkspaceImportPreviewProps): ReactElement {
  const { copy, preview, options, isControlDisabled, onOptionsChange } = props;

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
      {options.addImportTag ? (
        <label className="workspace-import-tag-field" htmlFor="workspace-package-import-tag-input">
          <span>{copy.importTagValueLabel}</span>
          <input
            id="workspace-package-import-tag-input"
            type="text"
            value={options.importTag}
            disabled={isControlDisabled}
            data-testid="workspace-package-import-tag-input"
            onChange={(event) => onOptionsChange(updateImportTag(options, event.currentTarget.value))}
          />
        </label>
      ) : null}
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
      {preview.warnings.length === 0 ? null : (
        <div className="workspace-import-preview-warnings" data-testid="workspace-package-import-preview-warnings">
          <strong>{copy.warningsTitle}</strong>
          <ul>
            {preview.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
          </ul>
        </div>
      )}
      {preview.tags.length === 0 ? null : (
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
    </section>
  );
}

export function WorkspaceImportPresentation(props: WorkspaceImportPresentationProps): ReactElement {
  const {
    copy,
    preview,
    options,
    isControlDisabled,
    canConfirm,
    isConfirming,
    unavailableMessage,
    errorMessage,
    successMessage,
    onSelect,
    onOptionsChange,
    onConfirm,
  } = props;

  return (
    <Fragment>
      <article className="content-card workspace-export-format-card">
        <div className="settings-nav-card-copy">
          <strong className="panel-subtitle">{copy.title}</strong>
          <p className="subtitle">{copy.description}</p>
        </div>
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
        {preview === null ? null : (
          <WorkspaceImportPreview
            copy={copy}
            preview={preview}
            options={options}
            isControlDisabled={isControlDisabled}
            onOptionsChange={onOptionsChange}
          />
        )}
        <div className="workspace-export-actions">
          <button
            className="primary-btn"
            type="button"
            disabled={isControlDisabled}
            data-testid="workspace-package-import-button"
            onClick={onSelect}
          >
            {copy.selectionActionLabel}
          </button>
          <button
            className="primary-btn"
            type="button"
            disabled={!canConfirm}
            data-testid="workspace-package-import-confirm-button"
            onClick={() => onConfirm(options)}
          >
            {isConfirming ? copy.confirmingActionLabel : copy.confirmActionLabel}
          </button>
        </div>
        {unavailableMessage === null ? null : (
          <p className="subtitle" data-testid="workspace-package-import-unavailable">{unavailableMessage}</p>
        )}
      </article>
      {errorMessage === "" ? null : (
        <p className="error-banner" role="alert" data-testid="workspace-import-error">{errorMessage}</p>
      )}
      {successMessage === "" ? null : (
        <p className="subtitle" data-testid="workspace-import-success">{successMessage}</p>
      )}
    </Fragment>
  );
}
