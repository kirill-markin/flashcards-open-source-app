import Charts
import SwiftUI
import WidgetKit

let reviewsChartWidgetKind: String = "ReviewsChartWidget"

private let reviewsChartDayPlotLabel: String = "Day"
private let reviewsChartReviewsPlotLabel: String = "Reviews"
private let reviewsChartAveragePlotLabel: String = "Daily average"

struct ReviewsChartWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: reviewsChartWidgetKind, provider: ReviewWidgetTimelineProvider()) { entry in
            ReviewsChartWidgetView(entry: entry)
        }
        .configurationDisplayName(Text("widget.reviews_chart.gallery.name", tableName: widgetStringsTableName))
        .description(Text("widget.reviews_chart.gallery.description", tableName: widgetStringsTableName))
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct ReviewsChartWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ReviewWidgetEntry

    var body: some View {
        Group {
            if let size = widgetChartSize(family: self.family) {
                Group {
                    if let summary = makeReviewsChartSummary(entry: self.entry, dayCount: reviewsChartDayCount(size: size)) {
                        ReviewsChartContentView(size: size, summary: summary)
                    } else {
                        WidgetNoSnapshotView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .widgetURL(
                    makeWidgetDeepLinkURL(
                        deepLink: WidgetDeepLink(
                            destination: .progress,
                            kind: .reviewsChart,
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

private func reviewsChartDayCount(size: WidgetChartSize) -> Int {
    switch size {
    case .medium:
        return 14
    case .large:
        return 30
    }
}

private func reviewsChartTickStride(size: WidgetChartSize) -> Int {
    switch size {
    case .medium:
        return 4
    case .large:
        return 7
    }
}

private struct ReviewsChartDay: Identifiable {
    let date: Date
    let progressDay: WidgetSnapshotProgressDay

    var id: String {
        self.progressDay.localDate
    }
}

private struct ReviewsChartSummary {
    let dayCount: Int
    let days: [ReviewsChartDay]
    let dailyAverage: Double
    /// Rounded percent change against the period of the same length before; nil when that period had no reviews.
    let changePercent: Int?
}

/// Nil without progress, once the entry has moved past the day the app wrote progress on, or for a malformed day.
private func makeReviewsChartSummary(entry: ReviewWidgetEntry, dayCount: Int) -> ReviewsChartSummary? {
    guard let progress = entry.snapshot?.progress, isWidgetProgressForDay(progress: progress, date: entry.date) else {
        return nil
    }
    let shownDays = Array(progress.days.suffix(dayCount))
    var chartDays: [ReviewsChartDay] = []
    for day in shownDays {
        guard let date = widgetLocalDayStart(localDate: day.localDate) else {
            reviewWidgetLogger.error(
                "event=reviews_chart_widget_progress_invalid localDate=\(day.localDate, privacy: .public)"
            )
            return nil
        }
        chartDays.append(ReviewsChartDay(date: date, progressDay: day))
    }
    let previousDays = progress.days.dropLast(dayCount).suffix(dayCount)
    let shownReviewCount = shownDays.reduce(0) { total, day in total + day.reviewCount }
    let previousReviewCount = previousDays.reduce(0) { total, day in total + day.reviewCount }
    let changePercent: Int? = previousReviewCount > 0
        ? Int((Double(shownReviewCount - previousReviewCount) / Double(previousReviewCount) * 100).rounded())
        : nil
    return ReviewsChartSummary(
        dayCount: dayCount,
        days: chartDays,
        dailyAverage: shownDays.isEmpty ? 0 : Double(shownReviewCount) / Double(shownDays.count),
        changePercent: changePercent
    )
}

private struct ReviewsChartContentView: View {
    let size: WidgetChartSize
    let summary: ReviewsChartSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ReviewsChartHeaderView(summary: self.summary)
            ReviewsChartPlotView(size: self.size, summary: self.summary)
            if self.size == .large {
                ReviewsChartRatingLegendView(days: self.summary.days)
            }
        }
    }
}

private struct ReviewsChartHeaderView: View {
    let summary: ReviewsChartSummary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(
                "widget.reviews_chart.daily_average \(self.summary.dailyAverage.formatted(.number.precision(.fractionLength(0 ... 1))))",
                tableName: widgetStringsTableName
            )
            .font(.headline)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let changePercent = self.summary.changePercent {
                reviewsChartTrendText(changePercent: changePercent, dayCount: self.summary.dayCount)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }
}

private func reviewsChartTrendText(changePercent: Int, dayCount: Int) -> Text {
    if changePercent > 0 {
        return Text("widget.reviews_chart.trend.higher \(changePercent) \(dayCount)", tableName: widgetStringsTableName)
    }
    if changePercent < 0 {
        return Text("widget.reviews_chart.trend.lower \(-changePercent) \(dayCount)", tableName: widgetStringsTableName)
    }
    return Text("widget.reviews_chart.trend.same \(dayCount)", tableName: widgetStringsTableName)
}

private struct ReviewsChartRatingSegment: Identifiable {
    let day: ReviewsChartDay
    let ratingIndex: Int
    let yStart: Int
    let yEnd: Int

    var id: String {
        "\(self.day.id)-\(self.ratingIndex)"
    }
}

/// Stacks each day's ratings bottom-up in Again, Hard, Good, Easy order, skipping empty ratings.
private func makeReviewsChartRatingSegments(days: [ReviewsChartDay]) -> [ReviewsChartRatingSegment] {
    days.flatMap { day -> [ReviewsChartRatingSegment] in
        var segments: [ReviewsChartRatingSegment] = []
        var yStart = 0
        for (ratingIndex, rating) in WidgetReviewRating.allCases.enumerated() {
            let count = widgetReviewRatingCount(day: day.progressDay, rating: rating)
            guard count > 0 else {
                continue
            }
            segments.append(
                ReviewsChartRatingSegment(day: day, ratingIndex: ratingIndex, yStart: yStart, yEnd: yStart + count)
            )
            yStart += count
        }
        return segments
    }
}

private struct ReviewsChartPlotView: View {
    @Environment(\.widgetAccent) private var accent
    @Environment(\.widgetRenderingMode) private var renderingMode
    let size: WidgetChartSize
    let summary: ReviewsChartSummary

    private var tickDates: [Date] {
        let tickStride = reviewsChartTickStride(size: self.size)
        return self.summary.days.reversed().enumerated().compactMap { offset, day in
            offset.isMultiple(of: tickStride) ? day.date : nil
        }
    }

    var body: some View {
        Chart {
            switch self.size {
            case .medium:
                ForEach(self.summary.days) { day in
                    BarMark(
                        x: .value(reviewsChartDayPlotLabel, day.date, unit: .day),
                        y: .value(reviewsChartReviewsPlotLabel, day.progressDay.reviewCount)
                    )
                    .foregroundStyle(self.accent.color)
                }
            case .large:
                ForEach(makeReviewsChartRatingSegments(days: self.summary.days)) { segment in
                    BarMark(
                        x: .value(reviewsChartDayPlotLabel, segment.day.date, unit: .day),
                        yStart: .value(reviewsChartReviewsPlotLabel, segment.yStart),
                        yEnd: .value(reviewsChartReviewsPlotLabel, segment.yEnd)
                    )
                    .foregroundStyle(
                        widgetSeriesColor(
                            color: widgetReviewRatingColor(rating: WidgetReviewRating.allCases[segment.ratingIndex]),
                            seriesIndex: segment.ratingIndex,
                            seriesCount: WidgetReviewRating.allCases.count,
                            renderingMode: self.renderingMode
                        )
                    )
                }
            }
            RuleMark(y: .value(reviewsChartAveragePlotLabel, self.summary.dailyAverage))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.secondary)
        }
        .chartYScale(domain: 0 ... max(self.summary.days.map(\.progressDay.reviewCount).max() ?? 0, 1))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: self.tickDates) { _ in
                AxisValueLabel(format: .dateTime.day(), centered: true)
            }
        }
        .widgetAccentable()
    }
}

private struct ReviewsChartRatingLegendView: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let days: [ReviewsChartDay]

    var body: some View {
        HStack(spacing: 10) {
            ForEach(Array(WidgetReviewRating.allCases.enumerated()), id: \.offset) { ratingIndex, rating in
                HStack(spacing: 4) {
                    WidgetLegendSwatch(
                        color: widgetSeriesColor(
                            color: widgetReviewRatingColor(rating: rating),
                            seriesIndex: ratingIndex,
                            seriesCount: WidgetReviewRating.allCases.count,
                            renderingMode: self.renderingMode
                        )
                    )
                    .widgetAccentable()
                    rating.title
                        .foregroundStyle(.secondary)
                    Text(
                        self.days.reduce(0) { total, day in
                            total + widgetReviewRatingCount(day: day.progressDay, rating: rating)
                        },
                        format: .number
                    )
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
        }
        .font(.caption2)
    }
}
