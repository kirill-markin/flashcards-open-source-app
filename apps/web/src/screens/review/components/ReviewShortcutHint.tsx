import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";

const REVIEW_SHORTCUT_HINT_KEY_TOKEN = "{{key}}";

type ReviewShortcutHintProps = Readonly<{
  keyLabel: string;
}>;

export function ReviewShortcutHint(props: ReviewShortcutHintProps): ReactElement {
  const { keyLabel } = props;
  const { t } = useI18n();
  const [hintPrefix, hintSuffix] = t("reviewScreen.shortcuts.hint").split(REVIEW_SHORTCUT_HINT_KEY_TOKEN);

  return (
    <span className="review-shortcut-hint" aria-hidden="true">
      {hintPrefix}
      <kbd className="review-shortcut-hint-key">{keyLabel}</kbd>
      {hintSuffix}
    </span>
  );
}
