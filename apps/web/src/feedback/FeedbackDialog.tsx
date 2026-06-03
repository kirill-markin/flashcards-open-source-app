import type { FormEvent, ReactElement } from "react";
import { useI18n } from "../i18n";
import {
  feedbackMaximumMessageLength,
  isFeedbackMessageSubmittable,
} from "./feedbackSubmission";

export type FeedbackDialogProps = Readonly<{
  isOpen: boolean;
  message: string;
  errorMessage: string;
  isSubmitting: boolean;
  onMessageChange: (message: string) => void;
  onSubmit: () => Promise<void>;
  onDismiss: () => void;
}>;

export function FeedbackDialog(props: FeedbackDialogProps): ReactElement | null {
  const {
    errorMessage,
    isOpen,
    isSubmitting,
    message,
    onDismiss,
    onMessageChange,
    onSubmit,
  } = props;
  const { t } = useI18n();
  const isSubmitDisabled = isSubmitting || isFeedbackMessageSubmittable(message) === false;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSubmitDisabled) {
      return;
    }

    void onSubmit();
  }

  if (isOpen === false) {
    return null;
  }

  return (
    <div className="feedback-dialog-overlay">
      <form
        className="panel feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        aria-describedby="feedback-dialog-body"
        onSubmit={handleSubmit}
        data-testid="feedback-dialog"
      >
        <div>
          <h2 id="feedback-dialog-title" className="title">{t("feedback.title")}</h2>
          <p id="feedback-dialog-body" className="subtitle feedback-dialog-body">{t("feedback.body")}</p>
        </div>

        <label className="form-label feedback-dialog-field">
          <span>{t("feedback.fieldLabel")}</span>
          <textarea
            className="settings-input feedback-textarea"
            maxLength={feedbackMaximumMessageLength}
            rows={7}
            value={message}
            placeholder={t("feedback.placeholder")}
            disabled={isSubmitting}
            onChange={(event) => onMessageChange(event.currentTarget.value)}
            data-testid="feedback-message"
          />
        </label>

        {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}

        <div className="feedback-dialog-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={isSubmitting}
            onClick={onDismiss}
            data-testid="feedback-dismiss"
          >
            {t("feedback.notNow")}
          </button>
          <button
            type="submit"
            className="primary-btn"
            disabled={isSubmitDisabled}
            data-testid="feedback-submit"
          >
            {isSubmitting ? t("feedback.sending") : t("feedback.send")}
          </button>
        </div>
      </form>
    </div>
  );
}
