import type { ReactElement } from "react";
import { useI18n } from "../i18n";

export function FeedbackRequestBody(): ReactElement {
  const { t } = useI18n();
  const bodyCopy = t("feedback.body").split("{{creator}}");

  return <>{bodyCopy[0]}<a className="feedback-creator-link" href="https://kirill-markin.com/" target="_blank" rel="noreferrer">Kirill Markin</a>{bodyCopy[1]}</>;
}
