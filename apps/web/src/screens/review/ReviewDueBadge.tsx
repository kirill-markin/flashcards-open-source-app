import type { ReactElement } from "react";
import { useI18n } from "../../i18n";

export function ReviewDueBadge(props: Readonly<{ dueCount: number; id?: string }>): ReactElement | null {
  const { t, formatNumber } = useI18n();
  if (props.dueCount === 0) return null;

  const formattedDueCount = formatNumber(props.dueCount);
  return (
    <span
      className="review-due-badge"
      id={props.id}
      role="img"
      aria-label={t("reviewFilterMenu.queueBadgeDue", { due: formattedDueCount })}
    >
      <span aria-hidden="true">{formattedDueCount}</span>
    </span>
  );
}
