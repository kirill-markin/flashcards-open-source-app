import SwiftUI
import WidgetKit

let dashboardWidgetKind: String = "DashboardWidget"

private let dashboardWidgetWeekCount: Int = 5
private let dashboardWidgetCellSpacing: CGFloat = 2
private let dashboardWidgetRingSide: CGFloat = 64
private let dashboardWidgetRingLineWidth: CGFloat = 6
private let dashboardWidgetHeatmapHeight: CGFloat = 104

struct DashboardWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: dashboardWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            DashboardWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.dashboard.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.dashboard.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemLarge])
    }
}

/// Everything the Dashboard needs from Progress; the Review content comes from the entry.
private struct DashboardWidgetProgress {
    let today: WidgetTodayProgress
    let weeks: WidgetHeatmapWeeks
}

/// Nil before the app has written a snapshot, while Progress has not loaded, or for malformed progress.
private func makeDashboardWidgetProgress(entry: ReviewWidgetEntry) -> DashboardWidgetProgress? {
    guard
        let progress = entry.snapshot?.progress,
        let today = makeWidgetTodayProgress(entry: entry),
        let weeks = makeWidgetHeatmapWeeks(progress: progress, weekCount: dashboardWidgetWeekCount, entryDate: entry.date)
    else {
        return nil
    }
    return DashboardWidgetProgress(today: today, weeks: weeks)
}

/// The card whose question the Dashboard shows, so a tap opens Review on it; nil while it shows no card.
private func dashboardWidgetShownCardId(progress: DashboardWidgetProgress?, content: ReviewWidgetContent) -> String? {
    guard progress != nil, case .due(_, let nextCard?, _) = content else {
        return nil
    }
    return nextCard.cardId
}

struct DashboardWidgetView: View {
    let entry: ReviewWidgetEntry

    var body: some View {
        let progress = makeDashboardWidgetProgress(entry: self.entry)
        Group {
            if let progress {
                DashboardWidgetContentView(entry: self.entry, progress: progress)
            } else {
                WidgetNoSnapshotView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(
            makeWidgetDeepLinkURL(
                deepLink: WidgetDeepLink(
                    destination: .review,
                    kind: .dashboard,
                    workspaceId: self.entry.workspaceId,
                    size: .large,
                    cardId: dashboardWidgetShownCardId(progress: progress, content: self.entry.content),
                    revealAnswer: false
                )
            )
        )
        .homeScreenWidgetStyle(accentColor: self.entry.snapshot?.accentColor)
    }
}

private struct DashboardWidgetContentView: View {
    let entry: ReviewWidgetEntry
    let progress: DashboardWidgetProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                WidgetPaceRingView(pace: self.progress.today.pace, lineWidth: dashboardWidgetRingLineWidth, numberFont: .subheadline)
                    .frame(width: dashboardWidgetRingSide, height: dashboardWidgetRingSide)
                VStack(alignment: .leading, spacing: 2) {
                    ReviewWidgetDueCountView(count: widgetDueCount(content: self.entry.content) ?? 0)
                    if let scheduledDueCount = self.entry.scheduledDueCount {
                        ReviewWidgetScheduledDueView(scheduledDueCount: scheduledDueCount, minutes: nil)
                    }
                }
                Spacer(minLength: 8)
                DashboardWidgetStreakView(today: self.progress.today)
            }
            Group {
                switch self.entry.content {
                case .due(_, let nextCard, _):
                    // The question always owns three lines, so the button and the heatmap never move with it.
                    VStack(alignment: .leading, spacing: 8) {
                        ReviewWidgetNextCardView(
                            nextCard: nextCard,
                            font: .title3.weight(.semibold),
                            lineLimit: 3,
                            reservesLines: true
                        )
                        if let nextCard {
                            WidgetRevealAnswerButton(
                                deepLink: makeWidgetRevealAnswerDeepLink(
                                    kind: .dashboard,
                                    workspaceId: self.entry.workspaceId,
                                    size: .large,
                                    cardId: nextCard.cardId
                                )
                            )
                        }
                    }
                case .allDone(let nextDueAt, _):
                    // The top row already shows the streak.
                    ReviewWidgetAllDoneView(entryDate: self.entry.date, nextDueAt: nextDueAt, streakDays: nil)
                case .noSnapshot:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            DashboardWidgetHeatmapView(weeks: self.progress.weeks)
        }
    }
}

/// The flame takes the accent colour once the user has reviewed today, as on the Today widget.
private struct DashboardWidgetStreakView: View {
    @Environment(\.widgetAccent) private var accent
    let today: WidgetTodayProgress

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill")
                .foregroundStyle(self.today.reviewedTodayCount > 0 ? self.accent.color : Color.secondary)
                .widgetAccentable(self.today.reviewedTodayCount > 0)
            Text("widget.streak_days \(self.today.streakDays)", tableName: widgetStringsTableName)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .font(.subheadline.weight(.semibold))
    }
}

private struct DashboardWidgetHeatmapView: View {
    let weeks: WidgetHeatmapWeeks

    var body: some View {
        HStack(alignment: .bottom, spacing: 16) {
            WidgetHeatmapWeekGridView(columns: self.weeks.columns, spacing: dashboardWidgetCellSpacing)
                .aspectRatio(CGFloat(self.weeks.columns.count) / 7, contentMode: .fit)
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "widget.heatmap.reviews_count \(widgetHeatmapReviewCount(days: self.weeks.shownDays))",
                    tableName: widgetStringsTableName
                )
                .font(.subheadline.weight(.semibold))
                Text(
                    "widget.heatmap.active_days_count \(widgetHeatmapActiveDayCount(days: self.weeks.shownDays))",
                    tableName: widgetStringsTableName
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .frame(height: dashboardWidgetHeatmapHeight)
    }
}
