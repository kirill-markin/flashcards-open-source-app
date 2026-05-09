import type { JSX } from "react";
import type { ReviewEventsByDateReport } from "../../adminApi";

export type ReviewEventsByDateSummaryCard = Readonly<{
  label: string;
  value: string;
}>;

export function buildReviewEventsByDateSummaryCards(
  filteredReport: ReviewEventsByDateReport,
  peakDailyVolume: number,
  peakDailyUniqueUsers: number,
): ReadonlyArray<ReviewEventsByDateSummaryCard> {
  return [
    { label: "Total Review Events", value: filteredReport.totalReviewEvents.toLocaleString("en-US") },
    { label: "Users With Review Events", value: filteredReport.users.length.toLocaleString("en-US") },
    { label: "Days In Range", value: filteredReport.dateTotals.length.toLocaleString("en-US") },
    { label: "Peak Daily Volume", value: peakDailyVolume.toLocaleString("en-US") },
    { label: "Peak Daily Unique Users", value: peakDailyUniqueUsers.toLocaleString("en-US") },
  ];
}

export function ReviewEventsByDateSummary(
  props: Readonly<{ cards: ReadonlyArray<ReviewEventsByDateSummaryCard> }>,
): JSX.Element {
  return (
    <section className="summary-grid">
      {props.cards.map((card) => (
        <article key={card.label} className="metric-card">
          <p className="metric-label">{card.label}</p>
          <p className="metric-value">{card.value}</p>
        </article>
      ))}
    </section>
  );
}
