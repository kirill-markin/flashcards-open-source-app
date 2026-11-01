import type { ReactElement } from "react";
import { useI18n } from "../../i18n";

const overdueBadgeOverflowThreshold: number = 99;

function formatOverdueBadgeValue(overdueCount: number, formatNumber: (value: number) => string): string {
  if (overdueCount > overdueBadgeOverflowThreshold) {
    return `${formatNumber(overdueBadgeOverflowThreshold)}+`;
  }

  return formatNumber(overdueCount);
}

export function ReviewOverdueBadge(props: Readonly<{ overdueCount: number }>): ReactElement | null {
  const { t, formatNumber } = useI18n();
  if (props.overdueCount === 0) return null;

  return (
    <span
      className="review-overdue-badge"
      role="img"
      aria-label={t("reviewFilterMenu.queueBadgeDue", { due: formatNumber(props.overdueCount) })}
    >
      <span aria-hidden="true">{formatOverdueBadgeValue(props.overdueCount, formatNumber)}</span>
    </span>
  );
}
