import type { ReactElement } from "react";
import { useI18n } from "../../../../i18n";
import {
  CardFormFields,
  isCardFormManagedMediaProcessing,
  type CardFormImageMediaRequest,
  type CardFormMediaUploadRetryRequest,
  type CardFormManagedMediaState,
  type CardFormState,
} from "../../../cards/form/CardForm";
import type { Card, TagSuggestion } from "../../../../types";

export type ReviewEditorModalProps = Readonly<{
  editingCard: Card | null;
  editorErrorMessage: string;
  formState: CardFormState;
  isEditorPresented: boolean;
  isEditorSaving: boolean;
  isSubmissionBlocked: boolean;
  localReadVersion: number;
  managedMediaState: CardFormManagedMediaState;
  workspaceId: string | null;
  onEditWithAi: () => Promise<void>;
  onChange: (nextFormState: CardFormState) => void;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onPrepareImageMedia: (request: CardFormImageMediaRequest) => Promise<string | null>;
  onRetryMediaUploadTransfer: (request: CardFormMediaUploadRetryRequest) => Promise<void>;
  onSave: () => Promise<void>;
  tagSuggestions: ReadonlyArray<TagSuggestion>;
}>;

export function ReviewEditorModal(props: ReviewEditorModalProps): ReactElement | null {
  const {
    editingCard,
    editorErrorMessage,
    formState,
    isEditorPresented,
    isEditorSaving,
    isSubmissionBlocked,
    localReadVersion,
    managedMediaState,
    workspaceId,
    onEditWithAi,
    onChange,
    onClose,
    onDelete,
    onPrepareImageMedia,
    onRetryMediaUploadTransfer,
    onSave,
    tagSuggestions,
  } = props;
  const { t } = useI18n();
  const isAuthoringMedia = isCardFormManagedMediaProcessing(managedMediaState);

  if (!isEditorPresented || editingCard === null) {
    return null;
  }

  return (
    <div className="review-editor-overlay">
      <section className="panel review-editor-modal" role="dialog" aria-modal="true" aria-labelledby="review-editor-title">
        <div className="screen-head">
          <div>
            <h2 id="review-editor-title" className="title">{t("reviewEditor.title")}</h2>
            <p className="subtitle">{t("reviewEditor.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <button
              type="button"
              className="ghost-btn review-editor-ai-btn"
              disabled={isEditorSaving || isAuthoringMedia || isSubmissionBlocked}
              onClick={() => void onEditWithAi()}
              data-testid="review-editor-edit-with-ai"
            >
              {t("reviewEditor.editWithAi")}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={isEditorSaving || isAuthoringMedia}
              onClick={onClose}
              data-testid="review-editor-cancel"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="ghost-btn review-editor-delete-btn"
              disabled={isEditorSaving || isAuthoringMedia}
              onClick={() => void onDelete()}
            >
              {t("reviewEditor.delete")}
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={isEditorSaving || isAuthoringMedia || isSubmissionBlocked}
              onClick={() => void onSave()}
            >
              {isEditorSaving ? t("reviewEditor.saving") : t("reviewEditor.save")}
            </button>
          </div>
        </div>

        {isSubmissionBlocked ? (
          <p
            className="error-banner"
            role="alert"
            data-testid="review-editor-lifecycle-conflict"
          >
            {t("cardForm.errors.mediaLifecycleConflict")}
          </p>
        ) : null}
        {editorErrorMessage !== "" ? (
          <p className="error-banner" role="alert">{editorErrorMessage}</p>
        ) : null}

        <CardFormFields
          tagSuggestions={tagSuggestions}
          currentCard={editingCard}
          formState={formState}
          formIdPrefix="review-card-editor"
          isSaving={isEditorSaving}
          localReadVersion={localReadVersion}
          managedMediaState={managedMediaState}
          workspaceId={workspaceId}
          onChange={onChange}
          onPrepareImageMedia={onPrepareImageMedia}
          onRetryMediaUploadTransfer={onRetryMediaUploadTransfer}
        />
      </section>
    </div>
  );
}
