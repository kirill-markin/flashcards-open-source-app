import OSLog
import SwiftUI
import WidgetKit

let todayWidgetKind: String = "TodayWidget"

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: todayWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.today.title", tableName: widgetStringsTableName))
        .description(Text("widget.today.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// The last 7 days against the usual, today's reviews and the streak, at the entry date.
struct WidgetTodayProgress: Sendable, Equatable {
    /// One count per local day, ascending and ending at the entry's day.
    let dayReviewCounts: [Int]
    let pace: ProgressPace
    let streakDays: Int
    /// False once the entry has moved past the day the app wrote progress on, where server facts of that day no
    /// longer apply.
    let isProgressDay: Bool

    var reviewedTodayCount: Int {
        self.dayReviewCounts.last ?? 0
    }
}

/// Nil before the app has written a snapshot, while Progress has not loaded, or for malformed progress.
/// Days after the one the app wrote progress on count as not yet reviewed.
func makeWidgetTodayProgress(entry: ReviewWidgetEntry) -> WidgetTodayProgress? {
    guard let progress = entry.snapshot?.progress else {
        return nil
    }
    guard
        let writeDay = progress.days.last,
        writeDay.localDate == progress.todayLocalDate,
        let writeDayStart = widgetLocalDayStart(localDate: progress.todayLocalDate),
        let laterDayCount = makeWidgetLocalCalendar().dateComponents(
            [.day],
            from: writeDayStart,
            to: makeWidgetLocalCalendar().startOfDay(for: entry.date)
        ).day,
        laterDayCount >= 0
    else {
        reviewWidgetLogger.error(
            "event=today_widget_progress_invalid todayLocalDate=\(progress.todayLocalDate, privacy: .public) lastLocalDate=\(String(describing: progress.days.last?.localDate), privacy: .public)"
        )
        return nil
    }
    let dayReviewCounts = progress.days.map(\.reviewCount) + Array(repeating: 0, count: laterDayCount)
    return WidgetTodayProgress(
        dayReviewCounts: dayReviewCounts,
        pace: makeProgressPace(dayReviewCounts: dayReviewCounts),
        streakDays: progress.currentStreakDays,
        isProgressDay: laterDayCount == 0
    )
}

/// The Review badge count at the entry date; nil without a snapshot.
func widgetDueCount(content: ReviewWidgetContent) -> Int? {
    switch content {
    case .noSnapshot:
        return nil
    case .due(let count, _, _):
        return count
    case .allDone:
        return 0
    }
}

/// The third line of the medium Today widget: a record within reach, else the time studied today.
private enum TodayWidgetThirdLine {
    case bestDay(reviewCount: Int)
    case newBestDay
    case studyMinutes(Int)
}

private let todayWidgetRecordsMinimumHistoryDayCount: Int = 14

/// A record shows from 80% of the best earlier day, after 14 days of history so early days are not all records.
/// Both it and the study time are the server's facts of the day the app wrote progress on.
private func makeTodayWidgetThirdLine(
    today: WidgetTodayProgress,
    progress: WidgetSnapshotProgress,
    insights: WidgetSnapshotInsights?
) -> TodayWidgetThirdLine? {
    guard today.isProgressDay, let insights else {
        return nil
    }
    let historyDayCount = today.dayReviewCounts.firstIndex { reviewCount in reviewCount > 0 }.map { firstIndex in
        today.dayReviewCounts.count - firstIndex
    } ?? 0
    if let bestDayCount = insights.bestDayBeforeToday?.reviewCount,
       bestDayCount > 0,
       historyDayCount >= todayWidgetRecordsMinimumHistoryDayCount {
        if today.reviewedTodayCount > bestDayCount {
            return .newBestDay
        }
        if today.reviewedTodayCount * 5 >= bestDayCount * 4 {
            return .bestDay(reviewCount: bestDayCount)
        }
    }
    let studySeconds = insights.studySecondsByDay?.first { studyDay in
        studyDay.localDate == progress.todayLocalDate
    }?.seconds
    return studySeconds.flatMap(makeStudyTimeMinutes(seconds:)).map(TodayWidgetThirdLine.studyMinutes)
}

private func todayWidgetThirdLineText(line: TodayWidgetThirdLine) -> Text {
    switch line {
    case .bestDay(let reviewCount):
        return Text("widget.records.best_day \(reviewCount)", tableName: widgetStringsTableName)
    case .newBestDay:
        return Text("widget.records.new_best_day", tableName: widgetStringsTableName)
    case .studyMinutes(let minutes):
        return Text("widget.minutes \(minutes)", tableName: widgetStringsTableName)
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = todayWidgetSize(family: self.family) {
                TodayWidgetContentView(size: size, entry: self.entry)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .review,
                                kind: .today,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: nil,
                                revealAnswer: false
                            )
                        )
                    )
            }
        }
        .homeScreenWidgetStyle(accentColor: self.entry.snapshot?.accentColor)
    }
}

/// The Home Screen families the Today widget supports.
private enum TodayWidgetSize {
    case small
    case medium

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .small:
            return .small
        case .medium:
            return .medium
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func todayWidgetSize(family: WidgetFamily) -> TodayWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemMedium:
        return .medium
    default:
        return nil
    }
}

private struct TodayWidgetContentView: View {
    let size: TodayWidgetSize
    let entry: ReviewWidgetEntry

    var body: some View {
        if let progress = self.entry.snapshot?.progress, let today = makeWidgetTodayProgress(entry: self.entry) {
            switch self.size {
            case .small:
                TodayWidgetSmallView(today: today)
            case .medium:
                TodayWidgetMediumView(
                    today: today,
                    scheduledDueCount: self.entry.scheduledDueCount,
                    thirdLine: makeTodayWidgetThirdLine(
                        today: today,
                        progress: progress,
                        insights: self.entry.snapshot?.insights
                    )
                )
            }
        } else {
            WidgetNoSnapshotView()
        }
    }
}

private struct TodayWidgetSmallView: View {
    let today: WidgetTodayProgress

    var body: some View {
        VStack(spacing: 6) {
            WidgetPaceRingView(pace: self.today.pace, lineWidth: 8, numberFont: .title2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack(spacing: 4) {
                Text("widget.today.count \(self.today.reviewedTodayCount)", tableName: widgetStringsTableName)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                TodayWidgetStreakView(today: self.today)
            }
            .font(.caption.weight(.semibold))
        }
    }
}

private struct TodayWidgetMediumView: View {
    let today: WidgetTodayProgress
    let scheduledDueCount: Int?
    let thirdLine: TodayWidgetThirdLine?

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            WidgetPaceRingView(pace: self.today.pace, lineWidth: 9, numberFont: .title2)
                .aspectRatio(1, contentMode: .fit)
            VStack(alignment: .leading, spacing: 4) {
                Text("widget.today.count \(self.today.reviewedTodayCount)", tableName: widgetStringsTableName)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Group {
                    if let scheduledDueCount = self.scheduledDueCount {
                        widgetScheduledDueText(scheduledDueCount: scheduledDueCount, minutes: nil)
                    }
                    if let thirdLine = self.thirdLine {
                        todayWidgetThirdLineText(line: thirdLine)
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            .frame(maxHeight: .infinity, alignment: .center)
            Spacer(minLength: 0)
            TodayWidgetStreakView(today: self.today)
                .font(.title3.weight(.semibold))
        }
    }
}

/// The flame takes the accent colour once the user has reviewed today, as on the Review streak badge.
private struct TodayWidgetStreakView: View {
    @Environment(\.widgetAccent) private var accent
    let today: WidgetTodayProgress

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "flame.fill")
                .foregroundStyle(self.today.reviewedTodayCount > 0 ? self.accent.color : Color.secondary)
                .widgetAccentable(self.today.reviewedTodayCount > 0)
            Text(self.today.streakDays, format: .number)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .fixedSize()
    }
}
