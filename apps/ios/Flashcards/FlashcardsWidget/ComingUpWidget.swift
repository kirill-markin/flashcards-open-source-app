import Charts
import SwiftUI
import WidgetKit

let comingUpWidgetKind: String = "ComingUpWidget"

/// The days after today, matching the snapshot forecast.
private let comingUpLaterDayCount: Int = 6
private let comingUpDayPlotLabel: String = "Day"
private let comingUpCardsPlotLabel: String = "Cards"

struct ComingUpWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: comingUpWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            ComingUpWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.coming_up.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.coming_up.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct ComingUpWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = widgetChartSize(family: self.family) {
                Group {
                    if let days = makeComingUpDays(entry: self.entry) {
                        ComingUpContentView(
                            size: size,
                            days: days,
                            reviewSchedule: comingUpReviewSchedule(entry: self.entry)
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
                            kind: .comingUp,
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

private struct ComingUpDay: Identifiable {
    let date: Date
    let dueCount: Int

    var id: Date {
        self.date
    }
}

/// Today's bar holds the cards due now and the later bars the forecast of the 6 days after the snapshot's day.
/// Nil without a forecast, and once the entry has moved past the snapshot's day, so the forecast no longer
/// covers the 6 days after the entry's day.
private func makeComingUpDays(entry: ReviewWidgetEntry) -> [ComingUpDay]? {
    guard
        let upcomingDueDays = entry.snapshot?.upcomingDueDays,
        let todayDueCount = widgetDueCount(content: entry.content)
    else {
        return nil
    }
    let laterDayStarts = Array(
        sequence(first: widgetNextLocalDayStart(after: entry.date), next: { dayStart in widgetNextLocalDayStart(after: dayStart) })
            .prefix(comingUpLaterDayCount)
    )
    guard upcomingDueDays.map(\.localDate) == laterDayStarts.map(widgetLocalDateString(date:)) else {
        if let malformedDay = upcomingDueDays.first(where: { dueDay in
            widgetLocalDayStart(localDate: dueDay.localDate) == nil
        }) {
            reviewWidgetLogger.error(
                "event=coming_up_widget_forecast_invalid localDate=\(malformedDay.localDate, privacy: .public)"
            )
        }
        return nil
    }
    let todayStart = makeWidgetLocalCalendar().startOfDay(for: entry.date)
    let laterDays = zip(laterDayStarts, upcomingDueDays).map { dayStart, dueDay in
        ComingUpDay(date: dayStart, dueCount: dueDay.dueCount)
    }
    return [ComingUpDay(date: todayStart, dueCount: todayDueCount)] + laterDays
}

/// The schedule belongs to the day the app wrote progress on; hidden on any other day.
private func comingUpReviewSchedule(entry: ReviewWidgetEntry) -> [WidgetSnapshotScheduleBucket]? {
    guard let progress = entry.snapshot?.progress, isWidgetProgressForDay(progress: progress, date: entry.date) else {
        return nil
    }
    return entry.snapshot?.reviewSchedule
}

private struct ComingUpContentView: View {
    let size: WidgetChartSize
    let days: [ComingUpDay]
    let reviewSchedule: [WidgetSnapshotScheduleBucket]?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(
                "widget.coming_up.header \(self.days.reduce(0) { total, day in total + day.dueCount })",
                tableName: widgetStringsTableName
            )
            .font(.headline)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            ComingUpPlotView(days: self.days)
            if self.size == .large, let reviewSchedule = self.reviewSchedule {
                ComingUpScheduleView(buckets: reviewSchedule)
            }
        }
    }
}

private struct ComingUpPlotView: View {
    @Environment(\.widgetAccent) private var accent
    let days: [ComingUpDay]

    var body: some View {
        // Headroom above the tallest bar keeps its count label inside the plot.
        let upperBound = Double(max(self.days.map(\.dueCount).max() ?? 0, 1)) * 1.25
        Chart(self.days) { day in
            BarMark(
                x: .value(comingUpDayPlotLabel, day.date, unit: .day),
                y: .value(comingUpCardsPlotLabel, day.dueCount)
            )
            .foregroundStyle(self.accent.color)
            .annotation(position: .top, spacing: 2) {
                Text(day.dueCount, format: .number)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
        .chartYScale(domain: 0 ... upperBound)
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: self.days.map(\.date)) { _ in
                AxisValueLabel(format: .dateTime.weekday(.abbreviated), centered: true)
            }
        }
        .widgetAccentable()
    }
}

private struct ComingUpScheduleView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let buckets: [WidgetSnapshotScheduleBucket]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("widget.coming_up.schedule_title", tableName: widgetStringsTableName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            ComingUpScheduleStripView(buckets: self.buckets)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                ForEach(0 ..< (self.buckets.count + 1) / 2, id: \.self) { row in
                    GridRow {
                        ForEach([row * 2, row * 2 + 1].filter { index in index < self.buckets.count }, id: \.self) { index in
                            HStack(spacing: 4) {
                                WidgetLegendSwatch(color: self.bucketColor(index: index))
                                    .widgetAccentable()
                                widgetScheduleBucketTitle(key: self.buckets[index].key)
                                    .foregroundStyle(.secondary)
                                Spacer(minLength: 4)
                                Text(self.buckets[index].count, format: .number)
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        }
                    }
                }
            }
            .font(.caption2)
        }
    }

    private func bucketColor(index: Int) -> Color {
        widgetSeriesColor(
            color: widgetScheduleBucketColor(key: self.buckets[index].key),
            seriesIndex: index,
            seriesCount: self.buckets.count,
            renderingMode: self.renderingMode
        )
    }
}

/// One horizontal bar split by bucket share; empty buckets take no width.
private struct ComingUpScheduleStripView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let buckets: [WidgetSnapshotScheduleBucket]

    var body: some View {
        let totalCount = self.buckets.reduce(0) { total, bucket in total + bucket.count }
        let filledIndices = self.buckets.indices.filter { index in self.buckets[index].count > 0 }
        GeometryReader { geometry in
            if totalCount > 0 {
                let segmentSpacing: CGFloat = 1
                let fillableWidth = geometry.size.width - segmentSpacing * CGFloat(filledIndices.count - 1)
                HStack(spacing: segmentSpacing) {
                    ForEach(filledIndices, id: \.self) { index in
                        Rectangle()
                            .fill(
                                widgetSeriesColor(
                                    color: widgetScheduleBucketColor(key: self.buckets[index].key),
                                    seriesIndex: index,
                                    seriesCount: self.buckets.count,
                                    renderingMode: self.renderingMode
                                )
                            )
                            .frame(width: fillableWidth * CGFloat(self.buckets[index].count) / CGFloat(totalCount))
                    }
                }
            } else {
                Rectangle()
                    .fill(.quaternary)
            }
        }
        .frame(height: 10)
        .clipShape(Capsule())
        .widgetAccentable()
    }
}
