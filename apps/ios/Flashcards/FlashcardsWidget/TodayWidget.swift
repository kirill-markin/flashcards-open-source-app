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

/// Today's reviews against the cards due now, the Review badge count.
struct WidgetTodayProgress: Sendable, Equatable {
    let reviewedCount: Int
    let leftCount: Int
    let streakDays: Int

    var totalCount: Int {
        self.reviewedCount + self.leftCount
    }

    var fraction: Double {
        self.totalCount == 0 ? 0 : Double(self.reviewedCount) / Double(self.totalCount)
    }
}

/// Nil before the app has written a snapshot, while Progress has not loaded, or for malformed progress.
/// Progress written on an earlier day counts as no reviews yet today.
func makeWidgetTodayProgress(entry: ReviewWidgetEntry) -> WidgetTodayProgress? {
    guard let progress = entry.snapshot?.progress, let leftCount = widgetDueCount(content: entry.content) else {
        return nil
    }
    guard let writeDay = progress.days.last, writeDay.localDate == progress.todayLocalDate else {
        reviewWidgetLogger.error(
            "event=today_widget_progress_invalid todayLocalDate=\(progress.todayLocalDate, privacy: .public) lastLocalDate=\(String(describing: progress.days.last?.localDate), privacy: .public)"
        )
        return nil
    }
    return WidgetTodayProgress(
        reviewedCount: isWidgetProgressForDay(progress: progress, date: entry.date) ? writeDay.reviewCount : 0,
        leftCount: leftCount,
        streakDays: progress.currentStreakDays
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

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = todayWidgetSize(family: self.family) {
                TodayWidgetContentView(size: size, progress: makeWidgetTodayProgress(entry: self.entry))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .review,
                                kind: .today,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: nil
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
    let progress: WidgetTodayProgress?

    var body: some View {
        if let progress = self.progress {
            switch self.size {
            case .small:
                TodayWidgetSmallView(progress: progress)
            case .medium:
                TodayWidgetMediumView(progress: progress)
            }
        } else {
            WidgetNoSnapshotView()
        }
    }
}

private struct TodayWidgetSmallView: View {
    let progress: WidgetTodayProgress

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                WidgetProgressRing(fraction: self.progress.fraction, lineWidth: 8)
                // Only today's reviews fit inside the ring; the due count can run into the thousands.
                if self.progress.totalCount > 0 {
                    Text(self.progress.reviewedCount, format: .number.notation(.compactName))
                        .font(.system(.title2, design: .rounded, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .padding(.horizontal, 14)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack(spacing: 4) {
                todayWidgetStatusText(
                    progress: self.progress,
                    leftText: Text("widget.today.left \(self.progress.leftCount)", tableName: widgetStringsTableName)
                )
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                TodayWidgetStreakView(progress: self.progress)
            }
            .font(.caption.weight(.semibold))
        }
    }
}

private struct TodayWidgetMediumView: View {
    @Environment(\.widgetAccent) private var accent
    let progress: WidgetTodayProgress

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("widget.today.title", tableName: widgetStringsTableName)
                    .font(.headline)
                    .lineLimit(1)
                Text("widget.today.reviewed \(self.progress.reviewedCount)", tableName: widgetStringsTableName)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Spacer(minLength: 0)
                HStack(spacing: 8) {
                    ProgressView(value: self.progress.fraction)
                        .tint(self.accent.color)
                        .widgetAccentable()
                    // Rounded down so cards still left never read as 100%.
                    Text(self.progress.fraction, format: .percent.precision(.fractionLength(0)).rounded(rule: .down))
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .fixedSize()
                }
                todayWidgetStatusText(
                    progress: self.progress,
                    leftText: Text("widget.today.cards_left \(self.progress.leftCount)", tableName: widgetStringsTableName)
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
            TodayWidgetStreakView(progress: self.progress)
                .font(.title3.weight(.semibold))
        }
    }
}

/// `leftText` names the cards still due; it is replaced once nothing is left.
private func todayWidgetStatusText(progress: WidgetTodayProgress, leftText: Text) -> Text {
    if progress.totalCount == 0 {
        return Text("widget.today.no_cards_due", tableName: widgetStringsTableName)
    }
    if progress.leftCount == 0 {
        return Text("widget.all_done.title", tableName: widgetStringsTableName)
    }
    return leftText
}

/// The flame takes the accent colour once the user has reviewed today, as on the Review streak badge.
private struct TodayWidgetStreakView: View {
    @Environment(\.widgetAccent) private var accent
    let progress: WidgetTodayProgress

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "flame.fill")
                .foregroundStyle(self.progress.reviewedCount > 0 ? self.accent.color : Color.secondary)
                .widgetAccentable(self.progress.reviewedCount > 0)
            Text(self.progress.streakDays, format: .number)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .fixedSize()
    }
}
