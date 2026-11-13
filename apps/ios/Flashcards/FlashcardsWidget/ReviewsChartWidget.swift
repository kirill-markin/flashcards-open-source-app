import Charts
import SwiftUI
import WidgetKit

let reviewsChartWidgetKind: String = "ReviewsChartWidget"

private let reviewsChartDayPlotLabel: String = "Day"
private let reviewsChartReviewsPlotLabel: String = "Reviews"
private let reviewsChartUsualPlotLabel: String = "Usual per day"

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
                    if let summary = makeReviewsChartSummary(entry: self.entry) {
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

private struct ReviewsChartDay: Identifiable {
    let date: Date
    let progressDay: WidgetSnapshotProgressDay

    var id: String {
        self.progressDay.localDate
    }
}

private struct ReviewsChartSummary {
    /// The last 7 days, the window of `pace`.
    let days: [ReviewsChartDay]
    let pace: ProgressPace
    /// Nil at 0 minutes or under the server's timing sample.
    let studyMinutes: Int?
}

/// Nil without progress, once the entry has moved past the day the app wrote progress on, or for a malformed day.
private func makeReviewsChartSummary(entry: ReviewWidgetEntry) -> ReviewsChartSummary? {
    guard let progress = entry.snapshot?.progress, isWidgetProgressForDay(progress: progress, date: entry.date) else {
        return nil
    }
    var chartDays: [ReviewsChartDay] = []
    for day in progress.days.suffix(progressPaceWindowDayCount) {
        guard let date = widgetLocalDayStart(localDate: day.localDate) else {
            reviewWidgetLogger.error(
                "event=reviews_chart_widget_progress_invalid localDate=\(day.localDate, privacy: .public)"
            )
            return nil
        }
        chartDays.append(ReviewsChartDay(date: date, progressDay: day))
    }
    let studySeconds = entry.snapshot?.insights?.studySecondsByDay?.reduce(0) { total, studyDay in
        total + studyDay.seconds
    }
    return ReviewsChartSummary(
        days: chartDays,
        pace: makeProgressPace(dayReviewCounts: progress.days.map(\.reviewCount)),
        studyMinutes: studySeconds.flatMap(makeStudyTimeMinutes(seconds:))
    )
}

private struct ReviewsChartContentView: View {
    let size: WidgetChartSize
    let summary: ReviewsChartSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ReviewsChartHeaderView(pace: self.summary.pace)
            ReviewsChartPlotView(size: self.size, summary: self.summary)
            if self.size == .large {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    ReviewsChartRatingLegendView(days: self.summary.days)
                    Spacer(minLength: 0)
                    if let studyMinutes = self.summary.studyMinutes {
                        Text("widget.minutes \(studyMinutes)", tableName: widgetStringsTableName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
            }
        }
    }
}

private struct ReviewsChartHeaderView: View {
    let pace: ProgressPace

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(
                "widget.reviews_chart.daily_average \(self.pace.lastSevenDaysAveragePerDay.formatted(.number.precision(.fractionLength(0 ... 1))))",
                tableName: widgetStringsTableName
            )
            .font(.headline)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let baseline = self.pace.baseline {
                ReviewsChartPaceView(percentChange: baseline.percentChange)
            }
        }
    }
}

/// The change against the usual, in the accent colour both ways; effort, never a grade.
private struct ReviewsChartPaceView: View {
    @Environment(\.widgetAccent) private var accent
    let percentChange: Int

    var body: some View {
        HStack(spacing: 2) {
            if self.percentChange != 0 {
                Image(systemName: self.percentChange > 0 ? "arrow.up" : "arrow.down")
            }
            Text(Double(abs(self.percentChange)) / 100, format: .percent.precision(.fractionLength(0)))
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(self.accent.color)
        .lineLimit(1)
        .fixedSize()
        .widgetAccentable()
    }
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
            if let baseline = self.summary.pace.baseline {
                RuleMark(y: .value(reviewsChartUsualPlotLabel, baseline.usualReviewsPerDay))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .foregroundStyle(Color.secondary)
            }
        }
        .chartYScale(domain: 0 ... max(self.upperBound, 1))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: self.summary.days.map(\.date)) { _ in
                switch self.size {
                case .medium:
                    AxisValueLabel(format: .dateTime.weekday(.narrow), centered: true)
                case .large:
                    AxisValueLabel(format: .dateTime.weekday(.narrow).day(), centered: true)
                }
            }
        }
        .widgetAccentable()
    }

    /// The dashed usual line stays inside the plot even above every bar.
    private var upperBound: Double {
        let tallestDay = Double(self.summary.days.map(\.progressDay.reviewCount).max() ?? 0)
        return max(tallestDay, self.summary.pace.baseline?.usualReviewsPerDay ?? 0)
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
