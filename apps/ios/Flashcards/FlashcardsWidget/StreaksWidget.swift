import SwiftUI
import WidgetKit

let streaksWidgetKind: String = "StreaksWidget"

private let streaksWidgetDotCount: Int = 7

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

private struct StreaksWidgetDot: Identifiable {
    let date: Date
    let state: WidgetSnapshotStreakDayState

    var id: Date {
        self.date
    }
}

/// The last 7 days, today last; rolling, never a calendar week.
private func makeStreaksWidgetDots(streakProgress: StreakWidgetProgress) -> [StreaksWidgetDot] {
    zip(streakProgress.dayDates, streakProgress.progress.days)
        .suffix(streaksWidgetDotCount)
        .map { date, day in StreaksWidgetDot(date: date, state: day.streakState) }
}

private struct StreaksWidgetContentView: View {
    let size: StreaksWidgetSize
    let progress: StreakWidgetProgress?

    var body: some View {
        if let progress {
            let dots = makeStreaksWidgetDots(streakProgress: progress)
            switch self.size {
            case .small:
                StreaksWidgetSmallView(progress: progress, dots: dots)
            case .medium:
                StreaksWidgetMediumView(progress: progress, dots: dots)
            }
        } else {
            WidgetNoSnapshotView()
        }
    }
}

private struct StreaksWidgetSmallView: View {
    let progress: StreakWidgetProgress
    let dots: [StreaksWidgetDot]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                StreaksWidgetCountView(progress: self.progress.progress, flameSize: 28, countSize: 40)
                Spacer(minLength: 4)
                StreaksWidgetFreezeView(availableFreezeCredits: self.progress.progress.availableFreezeCredits)
                    .font(.caption.weight(.semibold))
            }
            Text("widget.streaks.current", tableName: widgetStringsTableName)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            StreaksWidgetDotsView(dots: self.dots, displayCalendar: self.progress.displayCalendar, dotSide: 16)
        }
    }
}

private struct StreaksWidgetMediumView: View {
    let progress: StreakWidgetProgress
    let dots: [StreaksWidgetDot]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                StreaksWidgetCountView(progress: self.progress.progress, flameSize: 28, countSize: 40)
                Text("widget.streaks.current", tableName: widgetStringsTableName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                StreaksWidgetBestView(longestStreakDays: self.progress.progress.longestStreakDays)
                    .font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) {
                StreaksWidgetDotsView(dots: self.dots, displayCalendar: self.progress.displayCalendar, dotSide: 22)
                StreaksWidgetFreezeView(availableFreezeCredits: self.progress.progress.availableFreezeCredits)
                    .font(.subheadline.weight(.semibold))
            }
        }
    }
}

/// The flame stays grey until the first review today.
private struct StreaksWidgetCountView: View {
    @Environment(\.widgetAccent) private var accent
    let progress: WidgetSnapshotProgress
    let flameSize: CGFloat
    let countSize: CGFloat

    private var hasReviewedToday: Bool {
        self.progress.days.last?.streakState == .reviewed
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: "flame.fill")
                .font(.system(size: self.flameSize, weight: .semibold))
                .foregroundStyle(self.hasReviewedToday ? self.accent.color : Color.secondary)
                .widgetAccentable(self.hasReviewedToday)
            Text(self.progress.currentStreakDays, format: .number)
                .font(.system(size: self.countSize, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.4)
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

/// One dot per day with its weekday initial: reviewed, covered by a freeze, missed, or still open today.
private struct StreaksWidgetDotsView: View {
    let dots: [StreaksWidgetDot]
    let displayCalendar: Calendar
    let dotSide: CGFloat

    var body: some View {
        HStack(spacing: 0) {
            ForEach(self.dots) { dot in
                VStack(spacing: 3) {
                    StreaksWidgetDotView(state: dot.state, side: self.dotSide)
                    Text(dot.date, format: self.weekdayFormatStyle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var weekdayFormatStyle: Date.FormatStyle {
        Date.FormatStyle(
            date: nil,
            time: nil,
            locale: Locale.autoupdatingCurrent,
            calendar: self.displayCalendar,
            timeZone: self.displayCalendar.timeZone,
            capitalizationContext: .standalone
        )
        .weekday(.narrow)
    }
}

private struct StreaksWidgetDotView: View {
    @Environment(\.widgetAccent) private var accent
    let state: WidgetSnapshotStreakDayState
    let side: CGFloat

    var body: some View {
        ZStack {
            switch self.state {
            case .reviewed:
                Circle()
                    .fill(self.accent.color)
                    .widgetAccentable()
                Image(systemName: "checkmark")
                    .font(.system(size: self.side * 0.5, weight: .bold))
                    .foregroundStyle(self.accent.filledLabelColor)
            case .frozen:
                Circle()
                    .strokeBorder(streakWidgetFrozenColor, lineWidth: 1.5)
                Image(systemName: "snowflake")
                    .font(.system(size: self.side * 0.55, weight: .semibold))
                    .foregroundStyle(streakWidgetFrozenColor)
            case .missed:
                Circle()
                    .fill(Color.secondary.opacity(0.2))
            case .pending:
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1.5)
            }
        }
        .frame(width: self.side, height: self.side)
    }
}
