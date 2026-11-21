import type { ReactElement } from "react";
import { useI18n } from "../../../../../i18n";
import { WorkspaceImportFileField } from "../WorkspaceImportFileField";
import type { WorkspaceImportOptions } from "../useWorkspaceImportActions";
import type { WorkspacePackageImportCommands, WorkspacePackageImportFormState } from "./useWorkspacePackageImportController";
import type { WorkspaceImportPreviewModel } from "./workspaceImportPresentationModel";

type WorkspaceImportPresentationProps = Readonly<{
  state: WorkspacePackageImportFormState;
  commands: WorkspacePackageImportCommands;
}>;

type WorkspaceImportPreviewProps = Readonly<{
  preview: WorkspaceImportPreviewModel;
  options: WorkspaceImportOptions;
  isControlDisabled: boolean;
  commands: Pick<WorkspacePackageImportCommands, "setImportTag" | "toggleRemovedTag">;
}>;

function WorkspaceImportPreview(props: WorkspaceImportPreviewProps): ReactElement {
  const { preview, options, isControlDisabled, commands } = props;
  const { t } = useI18n();

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
          <span>{t("workspaceImport.importTagValueLabel")}</span>
          <input
            id="workspace-package-import-tag-input"
            type="text"
            value={options.importTag}
            disabled={isControlDisabled}
            data-testid="workspace-package-import-tag-input"
            onChange={(event) => commands.setImportTag(event.currentTarget.value)}
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
          <strong>{t("workspaceImport.previewWarningsTitle")}</strong>
          <ul>
            {preview.warnings.map((warning) => <li key={warning.id}>{warning.message}</li>)}
          </ul>
        </div>
      )}
      {preview.tags.length === 0 ? null : (
        <div className="workspace-import-preview-tags">
          <strong>{t("workspaceImport.previewTagsTitle")}</strong>
          <div className="workspace-import-preview-tag-list">
            {preview.tags.map((tagOption) => (
              <label key={tagOption.tag} className="workspace-import-preview-tag-control">
                <input
                  type="checkbox"
                  checked={options.removeTags.includes(tagOption.tag)}
                  disabled={isControlDisabled}
                  data-testid="workspace-package-remove-tag-checkbox"
                  data-tag={tagOption.tag}
                  onChange={() => commands.toggleRemovedTag(tagOption.tag)}
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

export function WorkspaceImportPresentation({ state, commands }: WorkspaceImportPresentationProps): ReactElement {
  const {
    fileName,
    preview,
    options,
    isControlDisabled,
    canSubmit,
    isPreviewing,
    isBusy,
    submitActionLabel,
    unavailableMessage,
    errorMessage,
    successMessage,
  } = state;
  const { t } = useI18n();

  return (
    <>
      <article
        className="content-card workspace-export-format-card"
        data-testid="workspace-package-import-card"
      >
        <p className="subtitle">{t("workspaceImport.packageDescription")}</p>
        <WorkspaceImportFileField
          accept=".zip,application/zip,application/x-zip-compressed"
          multiple={false}
          label={t("workspaceImport.packageImportButton")}
          isDisabled={isControlDisabled}
          isBusy={isPreviewing}
          inputTestId="workspace-package-import-file-input"
          pickerTestId="workspace-package-import-button"
          onSelect={commands.selectFiles}
        >
          {fileName === null ? null : (
            <p className="workspace-import-file-name" data-testid="workspace-package-import-file-name">
              <bdi>{fileName}</bdi>
            </p>
          )}
        </WorkspaceImportFileField>
        <details className="workspace-import-advanced">
          <summary data-testid="workspace-package-import-advanced">{t("settingsHome.groups.advanced")}</summary>
          <label className="workspace-import-tag-control">
            <input
              type="checkbox"
              checked={options.addImportTag}
              disabled={isControlDisabled}
              data-testid="workspace-package-import-tag-checkbox"
              onChange={(event) => commands.setImportTagEnabled(event.currentTarget.checked)}
            />
            <span className="workspace-import-tag-copy">
              <span>{t("workspaceImport.importTagLabel")}</span>
              <span className="subtitle">{t("workspaceImport.importTagDescription")}</span>
            </span>
          </label>
        </details>
        {preview === null ? null : (
          <WorkspaceImportPreview
            preview={preview}
            options={options}
            isControlDisabled={isControlDisabled}
            commands={commands}
          />
        )}
        <div className="workspace-export-actions">
          <button
            className="primary-btn"
            type="button"
            disabled={!canSubmit}
            aria-busy={isBusy}
            data-testid="workspace-package-import-confirm-button"
            onClick={() => void commands.submit()}
          >
            {submitActionLabel}
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
        <p className="subtitle" role="status" data-testid="workspace-import-success">{successMessage}</p>
      )}
    </>
  );
}
