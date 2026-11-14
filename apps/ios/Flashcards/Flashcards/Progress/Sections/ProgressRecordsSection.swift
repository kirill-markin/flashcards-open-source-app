import SwiftUI

/// Personal bests and plain counts; counts and bests only, never a grade. Today's local count can beat the server's
/// bests, which exclude today.
struct ProgressRecordsSection: View {
    let records: ProgressRecords
    let calendar: Calendar

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                String(
                    localized: "progress.screen.records.section_title",
                    defaultValue: "Records",
                    table: "Foundation",
                    comment: "Progress records section title"
                )
            )
            .font(.headline)

            VStack(alignment: .leading, spacing: 10) {
                if let bestDay = self.records.bestDay {
                    ProgressRecordsRow(
                        title: String(
                            localized: "progress.screen.records.best_day",
                            defaultValue: "Best day",
                            table: "Foundation",
                            comment: "Progress records row title for the day with the most reviews"
                        ),
                        value: bestDay.reviewCount,
                        detail: progressRecordsDayLabel(localDate: bestDay.date, calendar: self.calendar)
                    )
                }
                if let bestWeek = self.records.bestWeek {
                    ProgressRecordsRow(
                        title: String(
                            localized: "progress.screen.records.best_week",
                            defaultValue: "Best week",
                            table: "Foundation",
                            comment: "Progress records row title for the 7 consecutive days with the most reviews"
                        ),
                        value: bestWeek.reviewCount,
                        detail: progressRecordsWeekLabel(endLocalDate: bestWeek.endDate, calendar: self.calendar)
                    )
                }
                ProgressRecordsRow(
                    title: String(
                        localized: "progress.screen.records.longest_streak",
                        defaultValue: "Longest streak",
                        table: "Foundation",
                        comment: "Progress records row title for the longest streak in days"
                    ),
                    value: self.records.longestStreakDays,
                    detail: nil
                )
                ProgressRecordsRow(
                    title: String(
                        localized: "progress.screen.records.total_reviews",
                        defaultValue: "Total reviews",
                        table: "Foundation",
                        comment: "Progress records row title for all reviews ever"
                    ),
                    value: self.records.totalReviews,
                    detail: nil
                )
            }

            Text(
                String(
                    localized: "progress.screen.last_7_days",
                    defaultValue: "Last 7 days",
                    table: "Foundation",
                    comment: "Progress label for the rolling 7 local days ending today"
                )
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 4)

            VStack(alignment: .leading, spacing: 10) {
                ProgressRecordsRow(
                    title: String(
                        localized: "progress.screen.records.cards_met",
                        defaultValue: "Cards met",
                        table: "Foundation",
                        comment: "Progress records row title for cards reviewed for the first time in the last 7 days"
                    ),
                    value: self.records.cardsMetLast7Days,
                    detail: nil
                )
                ProgressRecordsRow(
                    title: String(
                        localized: "progress.screen.records.relearned",
                        defaultValue: "Relearned",
                        table: "Foundation",
                        comment: "Progress records row title for cards rated Again, then passed on a later day, in the last 7 days"
                    ),
                    value: self.records.relearnedLast7Days,
                    detail: nil
                )
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ProgressRecordsRow: View {
    let title: String
    let value: Int
    let detail: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(self.title)
                .font(.subheadline)
                .foregroundStyle(.primary)
            Spacer(minLength: 12)
            if let detail = self.detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(self.value.formatted())
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(.primary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct ProgressRecords: Hashable {
    let bestDay: ProgressBestDay?
    let bestWeek: ProgressBestWeek?
    let longestStreakDays: Int
    let totalReviews: Int
    let cardsMetLast7Days: Int
    let relearnedLast7Days: Int
}

/// Nil without the server's insights, so the card stays hidden offline and before the first refresh.
func makeProgressRecords(progressSnapshot: ProgressSnapshot) -> ProgressRecords? {
    guard let insights = progressSnapshot.insights, let today = progressSnapshot.chartData.chartDays.last else {
        return nil
    }
    let todayBestDay = ProgressBestDay(date: today.localDate, reviewCount: today.reviewCount)
    let todayBestWeek = ProgressBestWeek(
        endDate: today.localDate,
        reviewCount: progressSnapshot.chartData.chartDays.suffix(progressPaceWindowDayCount).reduce(0) { total, day in
            total + day.reviewCount
        }
    )
    return ProgressRecords(
        bestDay: progressRecordsBest(
            earlier: insights.bestDayBeforeToday,
            today: todayBestDay,
            reviewCount: \.reviewCount
        ),
        bestWeek: progressRecordsBest(
            earlier: insights.bestWeekBeforeToday,
            today: todayBestWeek,
            reviewCount: \.reviewCount
        ),
        longestStreakDays: progressSnapshot.summary.longestStreakDays,
        totalReviews: insights.totalReviews,
        cardsMetLast7Days: insights.cardsMetLast7Days,
        relearnedLast7Days: insights.relearnedLast7Days
    )
}

/// The earlier best, or today's once it is higher; nil before anything was reviewed.
private func progressRecordsBest<Record>(earlier: Record?, today: Record, reviewCount: (Record) -> Int) -> Record? {
    guard let earlier else {
        return reviewCount(today) > 0 ? today : nil
    }
    return reviewCount(today) > reviewCount(earlier) ? today : earlier
}

private func progressRecordsDayLabel(localDate: String, calendar: Calendar) -> String? {
    progressStrictDate(localDate: localDate, calendar: calendar).map { date in
        date.formatted(Date.FormatStyle(calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated).day())
    }
}

private func progressRecordsWeekLabel(endLocalDate: String, calendar: Calendar) -> String? {
    guard
        let endDate = progressStrictDate(localDate: endLocalDate, calendar: calendar),
        let startDate = calendar.date(byAdding: .day, value: 1 - progressPaceWindowDayCount, to: endDate)
    else {
        return nil
    }
    let formatter = DateIntervalFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateTemplate = "MMMd"
    return formatter.string(from: startDate, to: endDate)
}
