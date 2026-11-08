import OSLog
import SwiftUI
import WidgetKit

let streaksWidgetKind: String = "StreaksWidget"

private let streaksWidgetMaximumPastRunCount: Int = 4
private let streaksWidgetBarHeight: CGFloat = 14
private let streaksWidgetBarMinimumWidth: CGFloat = 26
private let streaksWidgetBarDateWidth: CGFloat = 40
private let streaksWidgetBarDateSpacing: CGFloat = 4

struct StreaksWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: streaksWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            StreaksWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.streaks.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.streaks.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StreaksWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = streaksWidgetSize(family: self.family) {
                StreaksWidgetContentView(
                    size: size,
                    progress: makeStreakWidgetProgress(
                        progress: self.entry.snapshot?.progress,
                        entryDate: self.entry.date
                    )
                )
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .widgetURL(
                        makeWidgetDeepLinkURL(
                            deepLink: WidgetDeepLink(
                                destination: .progress,
                                kind: .streaks,
                                workspaceId: self.entry.workspaceId,
                                size: size.deepLinkSize,
                                cardId: nil
                            )
                        )
                    )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

/// The Home Screen families the Streaks widget supports.
private enum StreaksWidgetSize {
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
private func streaksWidgetSize(family: WidgetFamily) -> StreaksWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemMedium:
        return .medium
    default:
        return nil
    }
}

private struct StreaksWidgetRun: Identifiable, Equatable {
    let startDate: Date
    let endDate: Date
    let dayCount: Int
    let isCurrent: Bool

    var id: Date {
        self.startDate
    }
}

/// Most recent first: the current streak when there is one, then up to 4 earlier streaks of the history window.
/// The current streak takes the app's length, so one longer than the window keeps its true length and start;
/// the oldest earlier streak may be cut at the window start. Nil when the current streak start is not a calendar date.
private func makeStreaksWidgetRuns(streakProgress: StreakWidgetProgress) -> [StreaksWidgetRun]? {
    let progress = streakProgress.progress
    var indexRuns: [(startIndex: Int, endIndex: Int)] = []
    var runStartIndex: Int? = nil
    for (index, day) in progress.days.enumerated() {
        if isStreakWidgetStreakDay(state: day.streakState) {
            if runStartIndex == nil {
                runStartIndex = index
            }
        } else if let startIndex = runStartIndex {
            indexRuns.append((startIndex: startIndex, endIndex: index - 1))
            runStartIndex = nil
        }
    }
    if let startIndex = runStartIndex {
        indexRuns.append((startIndex: startIndex, endIndex: progress.days.count - 1))
    }

    let lastIndex = progress.days.count - 1
    // Today still pending does not break the current streak.
    let currentEndIndex = progress.days.last?.streakState == .pending ? lastIndex - 1 : lastIndex
    let currentIndexRun = indexRuns.last.flatMap { indexRun in
        progress.currentStreakDays > 0 && indexRun.endIndex == currentEndIndex ? indexRun : nil
    }
    let pastIndexRuns = currentIndexRun == nil ? indexRuns[...] : indexRuns.dropLast()
    let pastRuns = pastIndexRuns.suffix(streaksWidgetMaximumPastRunCount).reversed().map { indexRun in
        StreaksWidgetRun(
            startDate: streakProgress.dayDates[indexRun.startIndex],
            endDate: streakProgress.dayDates[indexRun.endIndex],
            dayCount: indexRun.endIndex - indexRun.startIndex + 1,
            isCurrent: false
        )
    }
    guard let currentIndexRun else {
        return pastRuns
    }
    let currentEndDate = streakProgress.dayDates[currentIndexRun.endIndex]
    guard let currentStartDate = streakProgress.dayCalendar.date(
        byAdding: .day,
        value: 1 - progress.currentStreakDays,
        to: currentEndDate
    ) else {
        reviewWidgetLogger.error(
            "event=streaks_widget_current_start_invalid currentStreakDays=\(progress.currentStreakDays, privacy: .public) todayLocalDate=\(progress.todayLocalDate, privacy: .public)"
        )
        return nil
    }
    let currentRun = StreaksWidgetRun(
        startDate: currentStartDate,
        endDate: currentEndDate,
        dayCount: progress.currentStreakDays,
        isCurrent: true
    )
    return [currentRun] + pastRuns
}

private struct StreaksWidgetContentView: View {
    let size: StreaksWidgetSize
    let progress: StreakWidgetProgress?

    var body: some View {
        if let progress {
            switch self.size {
            case .small:
                StreaksWidgetSmallView(progress: progress.progress)
            case .medium:
                if let runs = makeStreaksWidgetRuns(streakProgress: progress) {
                    StreaksWidgetMediumView(
                        progress: progress.progress,
                        runs: runs,
                        dateFormatStyle: progress.dateFormatStyle
                    )
                } else {
                    WidgetNoSnapshotView()
                }
            }
        } else {
            WidgetNoSnapshotView()
        }
    }
}

private struct StreaksWidgetSmallView: View {
    let progress: WidgetSnapshotProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .widgetAccentable()
                Text(self.progress.currentStreakDays, format: .number)
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
            }
            Text("widget.streaks.current", tableName: widgetStringsTableName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                StreaksWidgetBestView(longestStreakDays: self.progress.longestStreakDays)
                Spacer(minLength: 0)
                StreaksWidgetFreezeView(availableFreezeCredits: self.progress.availableFreezeCredits)
            }
            .font(.caption.weight(.semibold))
        }
    }
}

private struct StreaksWidgetBestView: View {
    let longestStreakDays: Int

    var body: some View {
        Text("widget.streaks.best \(self.longestStreakDays)", tableName: widgetStringsTableName)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

private struct StreaksWidgetFreezeView: View {
    let availableFreezeCredits: Int

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: "snowflake")
                .foregroundStyle(streakWidgetFrozenColor)
            Text(self.availableFreezeCredits, format: .number)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text("widget.streaks.freezes \(self.availableFreezeCredits)", tableName: widgetStringsTableName)
        )
    }
}

private struct StreaksWidgetMediumView: View {
    let progress: WidgetSnapshotProgress
    let runs: [StreaksWidgetRun]
    let dateFormatStyle: Date.FormatStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .foregroundStyle(Color.accentColor)
                    .widgetAccentable()
                Text("widget.streak_days \(self.progress.currentStreakDays)", tableName: widgetStringsTableName)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                StreaksWidgetBestView(longestStreakDays: self.progress.longestStreakDays)
            }
            .font(.caption.weight(.semibold))
            if self.runs.isEmpty {
                Text("widget.streaks.empty", tableName: widgetStringsTableName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                Spacer(minLength: 0)
            } else {
                StreaksWidgetBarsView(runs: self.runs, dateFormatStyle: self.dateFormatStyle)
            }
        }
    }
}

/// Bars like a habit tracker's streak chart: each bar's length is proportional to its days, with its dates at the ends.
private struct StreaksWidgetBarsView: View {
    let runs: [StreaksWidgetRun]
    let dateFormatStyle: Date.FormatStyle

    var body: some View {
        GeometryReader { geometry in
            let longestDayCount = self.runs.map(\.dayCount).reduce(0, max)
            let dateColumnsWidth = 2 * (streaksWidgetBarDateWidth + streaksWidgetBarDateSpacing)
            let maximumBarWidth = max(geometry.size.width - dateColumnsWidth, streaksWidgetBarMinimumWidth)
            VStack(spacing: 4) {
                ForEach(self.runs) { run in
                    StreaksWidgetBarRow(
                        run: run,
                        barWidth: max(
                            streaksWidgetBarMinimumWidth,
                            maximumBarWidth * CGFloat(run.dayCount) / CGFloat(longestDayCount)
                        ),
                        dateFormatStyle: self.dateFormatStyle.month(.abbreviated).day()
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

private struct StreaksWidgetBarRow: View {
    let run: StreaksWidgetRun
    let barWidth: CGFloat
    let dateFormatStyle: Date.FormatStyle

    var body: some View {
        HStack(spacing: streaksWidgetBarDateSpacing) {
            StreaksWidgetBarDateView(date: self.run.startDate, dateFormatStyle: self.dateFormatStyle)
                .frame(width: streaksWidgetBarDateWidth, alignment: .trailing)
            ZStack {
                if self.run.isCurrent {
                    Capsule()
                        .fill(Color.accentColor)
                        .widgetAccentable()
                } else {
                    Capsule()
                        .fill(Color.secondary.opacity(0.3))
                }
                Text(self.run.dayCount, format: .number)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(self.run.isCurrent ? Color.white : Color.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, 4)
            }
            .frame(width: self.barWidth, height: streaksWidgetBarHeight)
            StreaksWidgetBarDateView(date: self.run.endDate, dateFormatStyle: self.dateFormatStyle)
                .frame(width: streaksWidgetBarDateWidth, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct StreaksWidgetBarDateView: View {
    let date: Date
    let dateFormatStyle: Date.FormatStyle

    var body: some View {
        Text(self.date, format: self.dateFormatStyle)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}
