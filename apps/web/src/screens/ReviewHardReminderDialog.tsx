import type { ReactElement } from "react";
import { useI18n } from "../i18n";

type ReviewHardReminderDialogProps = Readonly<{
  isOpen: boolean;
  onDismiss: () => void;
}>;

/**
 * Renders the non-blocking reminder shown after repeated Hard answers.
 */
export function ReviewHardReminderDialog(props: ReviewHardReminderDialogProps): ReactElement | null {
  const { isOpen, onDismiss } = props;
  const { t } = useI18n();

  if (isOpen === false) {
    return null;
  }

  return (
    <div className="review-hard-reminder-overlay">
      <section
        className="panel review-hard-reminder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-hard-reminder-title"
        aria-describedby="review-hard-reminder-body"
      >
        <div>
          <h2 id="review-hard-reminder-title" className="title">{t("reviewHardReminder.title")}</h2>
          <p id="review-hard-reminder-body" className="subtitle review-hard-reminder-body">
            {t("reviewHardReminder.body")}
          </p>
        </div>

        <div className="review-hard-reminder-actions">
          <button type="button" className="primary-btn" onClick={onDismiss}>
            {t("reviewHardReminder.dismiss")}
          </button>
        </div>
      </section>
    </div>
  );
}
