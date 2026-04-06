import type { ReactElement } from "react";
import { CardFormFields, type CardFormState } from "./CardForm";
import type { Card, TagSuggestion } from "../types";

type ReviewEditorModalProps = Readonly<{
  editingCard: Card | null;
  editorErrorMessage: string;
  formState: CardFormState;
  isEditorPresented: boolean;
  isEditorSaving: boolean;
  onEditWithAi: () => Promise<void>;
  onChange: (nextFormState: CardFormState) => void;
  onClose: () => void;
  onDelete: () => Promise<void>;
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
    onEditWithAi,
    onChange,
    onClose,
    onDelete,
    onSave,
    tagSuggestions,
  } = props;

  if (!isEditorPresented || editingCard === null) {
    return null;
  }

  return (
    <div className="review-editor-overlay">
      <section className="panel review-editor-modal" role="dialog" aria-modal="true" aria-labelledby="review-editor-title">
        <div className="screen-head">
          <div>
            <h2 id="review-editor-title" className="title">Edit card</h2>
            <p className="subtitle">Update the current review card without leaving review.</p>
          </div>
          <div className="screen-actions">
            <button
              type="button"
              className="ghost-btn review-editor-ai-btn"
              disabled={isEditorSaving}
              onClick={() => void onEditWithAi()}
            >
              Edit with AI
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={isEditorSaving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ghost-btn review-editor-delete-btn"
              disabled={isEditorSaving}
              onClick={() => void onDelete()}
            >
              Delete
            </button>
            <button
              type="button"
              className="primary-btn"
              disabled={isEditorSaving}
              onClick={() => void onSave()}
            >
              {isEditorSaving ? "Saving…" : "Save card"}
            </button>
          </div>
        </div>

        {editorErrorMessage !== "" ? <p className="error-banner">{editorErrorMessage}</p> : null}

        <CardFormFields
          tagSuggestions={tagSuggestions}
          currentCard={editingCard}
          formState={formState}
          formIdPrefix="review-card-editor"
          isSaving={isEditorSaving}
          onChange={onChange}
        />
      </section>
    </div>
  );
}
