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
