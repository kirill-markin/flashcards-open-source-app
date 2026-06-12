import Foundation
import SwiftUI

let progressStringsTableName: String = "Foundation"

func progressReviewChartPageDateRange(
    page: ProgressReviewChartPage,
    calendar: Calendar
) -> String {
    let formatter = DateIntervalFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    return formatter.string(from: page.startDate, to: page.endDate)
}

func requiredProgressPresentationCalendar(
    timeZoneIdentifier: String
) -> Calendar {
    do {
        return try makeProgressPresentationCalendar(
            timeZoneIdentifier: timeZoneIdentifier,
            userCalendar: Calendar.autoupdatingCurrent
        )
    } catch {
        preconditionFailure("Progress presentation calendar is invalid: \(error.localizedDescription)")
    }
}

func requiredProgressStreakWeeks(
    progressSnapshot: ProgressSnapshot,
    calendar: Calendar
) -> [ProgressCalendarWeek] {
    do {
        return try makeProgressStreakWeeks(
            chartDays: progressSnapshot.chartData.chartDays,
            rangeStartLocalDate: progressSnapshot.scopeKey.from,
            todayLocalDate: progressSnapshot.scopeKey.to,
            calendar: calendar
        )
    } catch {
        preconditionFailure("Progress streak weeks are invalid: \(error.localizedDescription)")
    }
}

func progressWeekdayLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.setLocalizedDateFormatFromTemplate("EEEEE")
    return formatter.string(from: date)
}

func progressCompleteDateLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateStyle = .full
    formatter.timeStyle = .none
    return formatter.string(from: date)
}

func progressReviewChartDayLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "d"
    return formatter.string(from: date)
}

func progressChartBarStyle(day: ProgressChartDay) -> AnyShapeStyle {
    if day.reviewCount > 0 {
        return AnyShapeStyle(Color.accentColor)
    }

    return AnyShapeStyle(Color(uiColor: .tertiarySystemFill))
}

func progressReviewScheduleBucketTitle(key: ReviewScheduleBucketKey) -> String {
    switch key {
    case .new:
        return String(
            localized: "progress.screen.review_schedule.bucket.new",
            defaultValue: "New",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards without a due date"
        )
    case .today:
        return String(
            localized: "progress.screen.review_schedule.bucket.today",
            defaultValue: "Today",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for overdue and due-today cards"
        )
    case .days1To7:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_1_to_7",
            defaultValue: "1-7 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in one to seven days"
        )
    case .days8To30:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_8_to_30",
            defaultValue: "8-30 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in eight to thirty days"
        )
    case .days31To90:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_31_to_90",
            defaultValue: "31-90 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in thirty-one to ninety days"
        )
    case .days91To360:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_91_to_360",
            defaultValue: "91-360 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in ninety-one to three hundred sixty days"
        )
    case .years1To2:
        return String(
            localized: "progress.screen.review_schedule.bucket.years_1_to_2",
            defaultValue: "1-2 years",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in one to two years"
        )
    case .later:
        return String(
            localized: "progress.screen.review_schedule.bucket.later",
            defaultValue: "Later",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due later than two years"
        )
    }
}

// Canonical palette, see docs/progress-pie-palette.md.
// Keep the hex values in sync with the Android and Web clients.
func progressReviewScheduleBucketColor(key: ReviewScheduleBucketKey) -> Color {
    switch key {
    case .new:
        return Color(red: 0xF4 / 255, green: 0xC4 / 255, blue: 0x30 / 255)
    case .today:
        return Color(red: 0xD7 / 255, green: 0x26 / 255, blue: 0x3D / 255)
    case .days1To7:
        return Color(red: 0x1F / 255, green: 0xB5 / 255, blue: 0xC1 / 255)
    case .days8To30:
        return Color(red: 0x8E / 255, green: 0x5B / 255, blue: 0xD9 / 255)
    case .days31To90:
        return Color(red: 0x2B / 255, green: 0xB6 / 255, blue: 0x73 / 255)
    case .days91To360:
        return Color(red: 0xE6 / 255, green: 0x9F / 255, blue: 0x00 / 255)
    case .years1To2:
        return Color(red: 0x3F / 255, green: 0x7C / 255, blue: 0xC8 / 255)
    case .later:
        return Color(red: 0x7A / 255, green: 0x80 / 255, blue: 0x88 / 255)
    }
}

func progressReviewScheduleBucketPercentage(
    bucket: ReviewScheduleBucket,
    totalCards: Int
) -> String {
    guard totalCards > 0 else {
        return Double(0).formatted(.percent.precision(.fractionLength(0)))
    }

    let ratio = Double(bucket.count) / Double(totalCards)
    return ratio.formatted(.percent.precision(.fractionLength(0)))
}

func progressReviewScheduleChartAccessibilityLabel() -> String {
    String(
        localized: "progress.screen.review_schedule.section_title",
        defaultValue: "Review schedule",
        table: progressStringsTableName,
        comment: "Progress review schedule section title"
    )
}

func progressReviewScheduleBucketAccessibilityValue(
    bucket: ReviewScheduleBucket,
    totalCards: Int
) -> String {
    let localizedFormat = String(
        localized: "progress.screen.review_schedule.bucket.accessibility_value",
        defaultValue: "%lld cards, %@",
        table: progressStringsTableName,
        comment: "Accessibility value for a review schedule bucket with card count and percentage"
    )
    return String(
        format: localizedFormat,
        locale: Locale.current,
        Int64(bucket.count),
        progressReviewScheduleBucketPercentage(bucket: bucket, totalCards: totalCards)
    )
}

func progressReviewScheduleAccessibilitySummary(snapshot: ReviewScheduleSnapshot) -> String {
    snapshot.schedule.buckets.map { bucket in
        "\(progressReviewScheduleBucketTitle(key: bucket.key)): \(progressReviewScheduleBucketAccessibilityValue(bucket: bucket, totalCards: snapshot.schedule.totalCards))"
    }
    .joined(separator: ", ")
}

func progressLeaderboardSectionTitle() -> String {
    String(
        localized: "progress.screen.leaderboard.section_title",
        defaultValue: "Leaderboard",
        table: progressStringsTableName,
        comment: "Progress leaderboard section title"
    )
}

// Keep the counting rule wording aligned with the backend metric copy in
// apps/backend/src/community/leaderboard/progressLeaderboard.ts.
func progressLeaderboardInfoMessage(snapshotGeneratedAt: String?, now: Date) -> String {
    let baseMessage = String(
        localized: "progress.screen.leaderboard.info.message",
        defaultValue: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
        table: progressStringsTableName,
        comment: "Progress leaderboard info explanation of which review ratings count"
    )

    guard let snapshotGeneratedAt,
          let updatedText = progressLeaderboardUpdatedText(snapshotGeneratedAt: snapshotGeneratedAt, now: now) else {
        return baseMessage
    }

    return "\(baseMessage)\n\n\(updatedText)"
}

func progressLeaderboardViewerRowTitle() -> String {
    String(
        localized: "progress.screen.leaderboard.row.you",
        defaultValue: "You",
        table: progressStringsTableName,
        comment: "Progress leaderboard label for the viewer's own row"
    )
}

func progressLeaderboardWindowTitle(key: LeaderboardWindowKey) -> String {
    switch key {
    case .last24Hours:
        return String(
            localized: "progress.screen.leaderboard.window.last_24_hours",
            defaultValue: "24h",
            table: progressStringsTableName,
            comment: "Progress leaderboard period selector label for the last 24 hours"
        )
    case .last3Days:
        return String(
            localized: "progress.screen.leaderboard.window.last_3_days",
            defaultValue: "3d",
            table: progressStringsTableName,
            comment: "Progress leaderboard period selector label for the last 3 days"
        )
    case .last7Days:
        return String(
            localized: "progress.screen.leaderboard.window.last_7_days",
            defaultValue: "7d",
            table: progressStringsTableName,
            comment: "Progress leaderboard period selector label for the last 7 days"
        )
    case .last30Days:
        return String(
            localized: "progress.screen.leaderboard.window.last_30_days",
            defaultValue: "30d",
            table: progressStringsTableName,
            comment: "Progress leaderboard period selector label for the last 30 days"
        )
    case .allTime:
        return String(
            localized: "progress.screen.leaderboard.window.all_time",
            defaultValue: "All time",
            table: progressStringsTableName,
            comment: "Progress leaderboard period selector label for all time"
        )
    }
}

func progressLeaderboardUpdatedText(snapshotGeneratedAt: String, now: Date) -> String? {
    guard let generatedAtDate = parseIsoTimestamp(value: snapshotGeneratedAt) else {
        return nil
    }

    let elapsedSeconds = max(0, now.timeIntervalSince(generatedAtDate))
    let elapsedMinutes = Int64(elapsedSeconds / 60)
    let localizedFormat = String(
        localized: "progress.screen.leaderboard.updated_at",
        defaultValue: "Updated %lld min ago",
        table: progressStringsTableName,
        comment: "Progress leaderboard freshness text with elapsed whole minutes"
    )
    return String(format: localizedFormat, locale: Locale.current, elapsedMinutes)
}
