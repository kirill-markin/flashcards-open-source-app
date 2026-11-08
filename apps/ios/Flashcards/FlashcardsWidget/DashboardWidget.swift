import SwiftUI
import WidgetKit

let dashboardWidgetKind: String = "DashboardWidget"

private let dashboardWidgetWeekCount: Int = 5
private let dashboardWidgetCellSpacing: CGFloat = 2
private let dashboardWidgetRingSide: CGFloat = 56
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
                DashboardWidgetContentView(entryDate: self.entry.date, content: self.entry.content, progress: progress)
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
                    cardId: dashboardWidgetShownCardId(progress: progress, content: self.entry.content)
                )
            )
        )
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

private struct DashboardWidgetContentView: View {
    let entryDate: Date
    let content: ReviewWidgetContent
    let progress: DashboardWidgetProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                DashboardWidgetRingView(today: self.progress.today)
                ReviewWidgetDueCountView(count: self.progress.today.leftCount)
                Spacer(minLength: 8)
                DashboardWidgetStreakView(today: self.progress.today)
            }
            Group {
                switch self.content {
                case .due(_, let nextCard, _):
                    ReviewWidgetNextCardView(nextCard: nextCard, font: .title3.weight(.semibold), lineLimit: 3)
                case .allDone(let nextDueAt, _):
                    // The top row already shows the streak.
                    ReviewWidgetAllDoneView(entryDate: self.entryDate, nextDueAt: nextDueAt, streakDays: nil)
                case .noSnapshot:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            DashboardWidgetHeatmapView(weeks: self.progress.weeks)
        }
    }
}

private struct DashboardWidgetRingView: View {
    let today: WidgetTodayProgress

    var body: some View {
        ZStack {
            WidgetProgressRing(fraction: self.today.fraction, lineWidth: dashboardWidgetRingLineWidth)
            // Only today's reviews fit inside the ring; the due count can run into the thousands.
            if self.today.totalCount > 0 {
                Text(self.today.reviewedCount, format: .number.notation(.compactName))
                    .font(.system(.subheadline, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .padding(.horizontal, 10)
            }
        }
        .frame(width: dashboardWidgetRingSide, height: dashboardWidgetRingSide)
    }
}

/// The flame takes the accent colour once the user has reviewed today, as on the Today widget.
private struct DashboardWidgetStreakView: View {
    let today: WidgetTodayProgress

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "flame.fill")
                .foregroundStyle(self.today.reviewedCount > 0 ? Color.accentColor : Color.secondary)
                .widgetAccentable(self.today.reviewedCount > 0)
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
