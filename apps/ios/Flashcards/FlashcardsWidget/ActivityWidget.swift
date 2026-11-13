import SwiftUI
import WidgetKit

let activityWidgetKind: String = "ActivityWidget"

private let activityWidgetSmallWeekCount: Int = 5
private let activityWidgetWideWeekCount: Int = 20
private let activityWidgetCellSpacing: CGFloat = 2

struct ActivityWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: activityWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            ActivityWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.activity.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.activity.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private enum ActivityWidgetSize {
    case small
    case medium
    case large

    var deepLinkSize: WidgetDeepLinkSize {
        switch self {
        case .small:
            return .small
        case .medium:
            return .medium
        case .large:
            return .large
        }
    }

    var weekCount: Int {
        switch self {
        case .small:
            return activityWidgetSmallWeekCount
        case .medium, .large:
            return activityWidgetWideWeekCount
        }
    }
}

/// Nil only for families the widget does not declare as supported.
private func activityWidgetSize(family: WidgetFamily) -> ActivityWidgetSize? {
    switch family {
    case .systemSmall:
        return .small
    case .systemMedium:
        return .medium
    case .systemLarge:
        return .large
    default:
        return nil
    }
}

/// The entry's due count, which grows as cards fall due after the snapshot was written.
private func activityWidgetDueNowCount(content: ReviewWidgetContent) -> Int {
    switch content {
    case .due(let count, _, _):
        return count
    case .noSnapshot, .allDone:
        return 0
    }
}

struct ActivityWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = activityWidgetSize(family: self.family) {
                Group {
                    if
                        let progress = self.entry.snapshot?.progress,
                        let weeks = makeWidgetHeatmapWeeks(progress: progress, weekCount: size.weekCount, entryDate: self.entry.date)
                    {
                        ActivityWidgetContentView(
                            size: size,
                            progress: progress,
                            weeks: weeks,
                            dueNowCount: activityWidgetDueNowCount(content: self.entry.content)
                        )
                    } else {
                        WidgetNoSnapshotView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(
                    makeWidgetDeepLinkURL(
                        deepLink: WidgetDeepLink(
                            destination: .progress,
                            kind: .activity,
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

private struct ActivityWidgetContentView: View {
    let size: ActivityWidgetSize
    let progress: WidgetSnapshotProgress
    let weeks: WidgetHeatmapWeeks
    let dueNowCount: Int

    var body: some View {
        switch self.size {
        case .small:
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 4) {
                    ActivityWidgetFlameView()
                    Text(self.progress.currentStreakDays, format: .number)
                        .font(.system(.title3, design: .rounded, weight: .bold))
                        .lineLimit(1)
                }
                WidgetHeatmapWeekGridView(columns: self.weeks.columns, spacing: activityWidgetCellSpacing)
            }
        case .medium:
            VStack(alignment: .leading, spacing: 8) {
                ActivityWidgetHeaderView(
                    currentStreakDays: self.progress.currentStreakDays,
                    shownReviewCount: widgetHeatmapReviewCount(days: self.weeks.shownDays)
                )
                WidgetHeatmapWeekGridView(columns: self.weeks.columns, spacing: activityWidgetCellSpacing)
            }
        case .large:
            VStack(alignment: .leading, spacing: 12) {
                WidgetHeatmapWeekGridView(columns: self.weeks.columns, spacing: activityWidgetCellSpacing)
                    .aspectRatio(CGFloat(self.weeks.columns.count) / 7, contentMode: .fit)
                ActivityWidgetStatsView(
                    progress: self.progress,
                    weeks: self.weeks,
                    dueNowCount: self.dueNowCount
                )
                Spacer(minLength: 0)
            }
        }
    }
}

private struct ActivityWidgetFlameView: View {
    @Environment(\.widgetAccent) private var accent
    var body: some View {
        Image(systemName: "flame.fill")
            .foregroundStyle(self.accent.color)
            .widgetAccentable()
    }
}

private struct ActivityWidgetHeaderView: View {
    let currentStreakDays: Int
    let shownReviewCount: Int

    var body: some View {
        HStack(spacing: 8) {
            if self.currentStreakDays > 0 {
                HStack(spacing: 4) {
                    ActivityWidgetFlameView()
                    Text("widget.heatmap.days_count \(self.currentStreakDays)", tableName: widgetStringsTableName)
                }
            }
            Spacer(minLength: 0)
            Text("widget.heatmap.reviews_count \(self.shownReviewCount)", tableName: widgetStringsTableName)
                .foregroundStyle(.secondary)
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
}

private struct ActivityWidgetStatsView: View {
    let progress: WidgetSnapshotProgress
    let weeks: WidgetHeatmapWeeks
    let dueNowCount: Int

    /// Zero once the snapshot is from an earlier day: nothing is reviewed yet today.
    private var todayReviewCount: Int {
        self.weeks.today?.reviewCount ?? 0
    }

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
            GridRow {
                ActivityWidgetStatView(
                    value: Text("widget.heatmap.days_count \(self.progress.currentStreakDays)", tableName: widgetStringsTableName),
                    label: Text("widget.activity.stat.current_streak", tableName: widgetStringsTableName)
                )
                ActivityWidgetStatView(
                    value: Text("widget.heatmap.days_count \(self.progress.longestStreakDays)", tableName: widgetStringsTableName),
                    label: Text("widget.activity.stat.best_streak", tableName: widgetStringsTableName)
                )
            }
            GridRow {
                ActivityWidgetStatView(
                    value: Text(widgetHeatmapReviewCount(days: self.weeks.shownDays), format: .number),
                    label: Text("widget.activity.stat.reviews_in_weeks \(self.weeks.columns.count)", tableName: widgetStringsTableName)
                )
                ActivityWidgetStatView(
                    value: Text(widgetHeatmapActiveDayCount(days: self.weeks.shownDays), format: .number),
                    label: Text("widget.activity.stat.active_days_in_weeks \(self.weeks.columns.count)", tableName: widgetStringsTableName)
                )
            }
            GridRow {
                ActivityWidgetStatView(
                    value: Text(self.todayReviewCount, format: .number),
                    label: Text("widget.activity.stat.reviews_today", tableName: widgetStringsTableName)
                )
                ActivityWidgetStatView(
                    value: Text(self.dueNowCount, format: .number),
                    label: Text("widget.activity.stat.due_now", tableName: widgetStringsTableName)
                )
            }
            GridRow {
                ActivityWidgetStatView(
                    value: Text(self.progress.availableFreezeCredits, format: .number),
                    label: Text("widget.activity.stat.streak_freezes", tableName: widgetStringsTableName)
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ActivityWidgetStatView: View {
    let value: Text
    let label: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            self.value
                .font(.system(.headline, design: .rounded, weight: .bold))
            self.label
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
