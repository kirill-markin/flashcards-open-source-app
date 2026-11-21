import Charts
import SwiftUI

private let progressChartHeight: CGFloat = 220
private let progressReviewsLegendMarkerSize: CGFloat = 10

private enum ProgressReviewsSelection: Hashable {
    case day(localDate: String)
    case rating(ReviewRating)
}

private struct ProgressReviewChartSegment: Identifiable {
    let day: ProgressChartDay
    let rating: ReviewRating
    let count: Int
    let yStart: Int
    let yEnd: Int

    var id: String {
        "\(self.day.localDate)-\(self.rating.rawValue)"
    }
}

private struct ProgressReviewRatingLegendEntry: Identifiable {
    let rating: ReviewRating
    let count: Int
    let totalReviewCount: Int

    var id: Int {
        self.rating.rawValue
    }
}

struct ProgressReviewsSection: View {
    let chartDays: [ProgressChartDay]
    /// The rolling last 7 days against the usual, whatever week the chart pages to.
    let pace: ProgressPace
    /// Nil at 0 minutes or under the server's timing sample.
    let studyMinutes: Int?
    let chartCalendar: Calendar
    let selectionResetKey: String
    @Binding var pageSelection: ProgressReviewChartPageSelection?
    @State private var selection: ProgressReviewsSelection? = nil

    private var pageSelectionResetToken: ProgressReviewChartSelectionResetToken {
        ProgressReviewChartSelectionResetToken(
            selectionResetKey: self.selectionResetKey,
            chartDays: self.chartDays
        )
    }

    private var selectedPageStartLocalDate: String? {
        guard let pageSelection = self.pageSelection, pageSelection.resetToken == self.pageSelectionResetToken else {
            return nil
        }

        return pageSelection.startLocalDate
    }

    private var chartPages: [ProgressReviewChartPage] {
        let today = self.chartDays.first(where: { day in day.isToday })?.date
        return makeProgressReviewChartPages(
            chartDays: self.chartDays,
            calendar: self.chartCalendar,
            today: today
        )
    }

    private var selectedPageIndex: Int {
        guard self.chartPages.isEmpty == false else {
            return 0
        }

        guard
            let selectedPageStartLocalDate = self.selectedPageStartLocalDate,
            let selectedPageIndex = self.chartPages.firstIndex(where: { page in
                page.startLocalDate == selectedPageStartLocalDate
            })
        else {
            return self.chartPages.count - 1
        }

        return selectedPageIndex
    }

    private var visiblePage: ProgressReviewChartPage? {
        guard self.chartPages.isEmpty == false else {
            return nil
        }

        return self.chartPages[self.selectedPageIndex]
    }

    private var selectedRating: ReviewRating? {
        guard let selection = self.selection else {
            return nil
        }

        switch selection {
        case .day:
            return nil
        case .rating(let rating):
            return rating
        }
    }

    private var selectedDayLocalDate: String? {
        guard let selection = self.selection else {
            return nil
        }

        switch selection {
        case .day(let localDate):
            return localDate
        case .rating:
            return nil
        }
    }

    private var chartDaySelectionBinding: Binding<String?> {
        Binding(
            get: {
                self.selectedDayLocalDate
            },
            set: { newValue in
                guard let newValue else {
                    if let selection = self.selection, case .day = selection {
                        self.selection = nil
                    }
                    return
                }

                self.selection = .day(localDate: newValue)
            }
        )
    }

    private var visibleDateLabel: String? {
        guard let visiblePage else {
            return nil
        }

        if let selectedDayLocalDate,
           let selectedDay = visiblePage.day(localDate: selectedDayLocalDate) {
            return progressReviewChartDateLabel(
                date: selectedDay.date,
                calendar: self.chartCalendar
            )
        }

        return progressReviewChartPageDateRange(
            page: visiblePage,
            calendar: self.chartCalendar
        )
    }

    private var visiblePageUpperBound: Int {
        guard let visiblePage else {
            return 1
        }

        let maximumReviewCount: Int
        if let selectedRating = self.selectedRating {
            maximumReviewCount = visiblePage.days.map { day in
                progressReviewRatingCount(day: day, rating: selectedRating)
            }.max() ?? 0
        } else {
            maximumReviewCount = visiblePage.days.map(\.reviewCount).max() ?? 0
        }
        guard self.selectedRating == nil, let baseline = self.pace.baseline else {
            return progressChartUpperBound(maximumReviewCount: maximumReviewCount)
        }
        // The dashed usual line stays inside the plot even above every bar.
        return progressChartUpperBound(
            maximumReviewCount: max(maximumReviewCount, Int(baseline.usualReviewsPerDay.rounded(.up)))
        )
    }

    private var visibleChartSegments: [ProgressReviewChartSegment] {
        guard let visiblePage else {
            return []
        }

        return makeProgressReviewChartSegments(
            days: visiblePage.days,
            selectedRating: self.selectedRating
        )
    }

    private var visibleRatingLegendEntries: [ProgressReviewRatingLegendEntry] {
        guard let visiblePage else {
            return []
        }

        let legendDays: [ProgressChartDay]
        if let selectedDayLocalDate,
           let selectedDay = visiblePage.day(localDate: selectedDayLocalDate) {
            legendDays = [selectedDay]
        } else {
            legendDays = visiblePage.days
        }

        let totalReviewCount = legendDays.reduce(0) { total, day in
            total + day.reviewCount
        }
        return progressReviewRatingChartOrder.map { rating in
            ProgressReviewRatingLegendEntry(
                rating: rating,
                count: legendDays.reduce(0) { total, day in
                    total + progressReviewRatingCount(day: day, rating: rating)
                },
                totalReviewCount: totalReviewCount
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        String(
                            localized: "progress.screen.reviews.section_title",
                            defaultValue: "Reviews",
                            table: "Foundation",
                            comment: "Progress reviews section title"
                        )
                    )
                    .font(.headline)

                    if let visibleDateLabel = self.visibleDateLabel {
                        Text(
                            visibleDateLabel
                        )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 0)

                if self.chartPages.count > 1 {
                    HStack(spacing: 6) {
                        Button(action: self.showPreviousPage) {
                            Image(systemName: "chevron.backward")
                                .font(.body.weight(.semibold))
                                .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                                .contentShape(Rectangle())
                        }
                        .disabled(self.selectedPageIndex == 0)
                        .accessibilityLabel(
                            String(
                                localized: "progress.screen.reviews.previous_week",
                                defaultValue: "Previous week",
                                table: "Foundation",
                                comment: "Accessibility label for the previous reviews week button"
                            )
                        )

                        Button(action: self.showNextPage) {
                            Image(systemName: "chevron.forward")
                                .font(.body.weight(.semibold))
                                .frame(minWidth: appMinimumTouchTarget, minHeight: appMinimumTouchTarget)
                                .contentShape(Rectangle())
                        }
                        .disabled(self.selectedPageIndex >= self.chartPages.count - 1)
                        .accessibilityLabel(
                            String(
                                localized: "progress.screen.reviews.next_week",
                                defaultValue: "Next week",
                                table: "Foundation",
                                comment: "Accessibility label for the next reviews week button"
                            )
                        )
                    }
                }
            }

            ProgressReviewsPaceRows(pace: self.pace, studyMinutes: self.studyMinutes)

            if let visiblePage = self.visiblePage {
                Chart {
                    ForEach(visiblePage.days) { day in
                        if day.isToday && day.reviewCount == 0 {
                            RectangleMark(
                                x: .value("Day", day.localDate),
                                yStart: .value("Floor", 0),
                                yEnd: .value("Ceiling", self.visiblePageUpperBound)
                            )
                            .foregroundStyle(.tint.opacity(0.12))
                            .cornerRadius(8)
                        }
                    }
                    ForEach(self.visibleChartSegments) { segment in
                        if segment.count > 0 {
                            BarMark(
                                x: .value("Day", segment.day.localDate),
                                yStart: .value("Start", segment.yStart),
                                yEnd: .value("End", segment.yEnd)
                            )
                            .foregroundStyle(self.segmentForegroundStyle(segment: segment))
                            .cornerRadius(6)
                            .accessibilityLabel(
                                "\(progressCompleteDateLabel(date: segment.day.date, calendar: self.chartCalendar)), \(progressReviewRatingTitle(rating: segment.rating))"
                            )
                            .accessibilityValue(segment.count.formatted())
                        }
                    }
                    // The usual daily average, the baseline the pace compares against.
                    if let baseline = self.pace.baseline, self.selectedRating == nil {
                        RuleMark(y: .value("Usual", baseline.usualReviewsPerDay))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                            .foregroundStyle(Color.secondary)
                    }
                }
                .chartLegend(.hidden)
                .chartXSelection(value: self.chartDaySelectionBinding)
                .chartXScale(domain: visiblePage.xAxisValues)
                .chartYScale(domain: 0 ... self.visiblePageUpperBound)
                .chartXAxis {
                    AxisMarks(values: visiblePage.xAxisValues) { value in
                        AxisTick()
                            .foregroundStyle(Color(uiColor: .separator).opacity(0.35))
                        AxisValueLabel {
                            if let localDate = value.as(String.self), let day = visiblePage.day(localDate: localDate) {
                                VStack(spacing: 2) {
                                    Text(
                                        progressWeekdayLabel(
                                            date: day.date,
                                            calendar: self.chartCalendar
                                        )
                                    )
                                    Text(
                                        progressReviewChartDayLabel(
                                            date: day.date,
                                            calendar: self.chartCalendar
                                        )
                                    )
                                }
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisGridLine()
                            .foregroundStyle(Color(uiColor: .separator).opacity(0.18))
                        AxisTick()
                            .foregroundStyle(Color(uiColor: .separator).opacity(0.35))
                        AxisValueLabel()
                    }
                }
                .chartPlotStyle { plotArea in
                    plotArea
                        .background(Color(uiColor: .secondarySystemGroupedBackground).opacity(0.45))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .frame(height: progressChartHeight)

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(self.visibleRatingLegendEntries) { entry in
                        ProgressReviewsRatingLegendRow(
                            entry: entry,
                            isSelected: self.selectedRating == entry.rating,
                            isAnyRatingSelected: self.selectedRating != nil,
                            onTap: {
                                self.toggleRatingSelection(rating: entry.rating)
                            }
                        )
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .onChange(of: self.pageSelectionResetToken) { _, _ in
            self.pageSelection = nil
            self.selection = nil
        }
    }

    private func showPreviousPage() {
        guard self.selectedPageIndex > 0 else {
            return
        }

        self.selectPage(startLocalDate: self.chartPages[self.selectedPageIndex - 1].startLocalDate)
        self.selection = nil
    }

    private func showNextPage() {
        guard self.selectedPageIndex < self.chartPages.count - 1 else {
            return
        }

        self.selectPage(startLocalDate: self.chartPages[self.selectedPageIndex + 1].startLocalDate)
        self.selection = nil
    }

    private func selectPage(startLocalDate: String) {
        self.pageSelection = ProgressReviewChartPageSelection(
            startLocalDate: startLocalDate,
            resetToken: self.pageSelectionResetToken
        )
    }

    private func segmentForegroundStyle(segment: ProgressReviewChartSegment) -> Color {
        if let selectedDayLocalDate = self.selectedDayLocalDate,
           segment.day.localDate != selectedDayLocalDate {
            return Color(uiColor: .tertiarySystemFill)
        }

        return progressReviewRatingColor(rating: segment.rating)
    }

    private func toggleRatingSelection(rating: ReviewRating) {
        if self.selectedRating == rating {
            self.selection = nil
        } else {
            self.selection = .rating(rating)
        }
    }
}

/// "Last 7 days · 13.1 a day ↑ 64%" and the time studied in those days, both rolling, never a calendar week.
private struct ProgressReviewsPaceRows: View {
    let pace: ProgressPace
    let studyMinutes: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(
                    String(
                        localized: "progress.screen.last_7_days",
                        defaultValue: "Last 7 days",
                        table: "Foundation",
                        comment: "Progress label for the rolling 7 local days ending today"
                    )
                )
                .font(.subheadline)
                Spacer(minLength: 12)
                Text(progressReviewsPerDayLabel(reviewsPerDay: self.pace.lastSevenDaysAveragePerDay))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                if let baseline = self.pace.baseline {
                    ProgressReviewsPaceChange(percentChange: baseline.percentChange)
                }
            }
            .accessibilityElement(children: .combine)

            if let studyMinutes = self.studyMinutes {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(
                        String(
                            localized: "progress.screen.reviews.study_time",
                            defaultValue: "Study time",
                            table: "Foundation",
                            comment: "Progress label for the estimated time studied in the last 7 days"
                        )
                    )
                    .font(.subheadline)
                    Spacer(minLength: 12)
                    Text(progressMinutesEstimateLabel(minutes: studyMinutes))
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// The change against the usual, in the tint both ways; effort, never a grade.
private struct ProgressReviewsPaceChange: View {
    let percentChange: Int

    var body: some View {
        HStack(spacing: 2) {
            if self.percentChange != 0 {
                Image(systemName: self.percentChange > 0 ? "arrow.up" : "arrow.down")
            }
            Text(Double(abs(self.percentChange)) / 100, format: .percent.precision(.fractionLength(0)))
        }
        .font(.subheadline.weight(.semibold).monospacedDigit())
        .foregroundStyle(.tint)
    }
}

private func makeProgressReviewChartSegments(
    days: [ProgressChartDay],
    selectedRating: ReviewRating?
) -> [ProgressReviewChartSegment] {
    days.flatMap { day in
        var yStart: Int = 0
        let ratings = progressReviewRatingChartOrder.filter { rating in
            guard let selectedRating else {
                return true
            }

            return rating == selectedRating
        }
        return ratings.map { rating in
            let count = progressReviewRatingCount(day: day, rating: rating)
            let segment = ProgressReviewChartSegment(
                day: day,
                rating: rating,
                count: count,
                yStart: yStart,
                yEnd: yStart + count
            )
            yStart += count
            return segment
        }
    }
}

private struct ProgressReviewsRatingLegendRow: View {
    let entry: ProgressReviewRatingLegendEntry
    let isSelected: Bool
    let isAnyRatingSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button {
            guard self.entry.count > 0 else {
                return
            }
            self.onTap()
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(progressReviewRatingColor(rating: self.entry.rating))
                    .overlay(
                        Circle().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
                    )
                    .frame(
                        width: progressReviewsLegendMarkerSize,
                        height: progressReviewsLegendMarkerSize
                    )
                    .accessibilityHidden(true)

                Text(progressReviewRatingTitle(rating: self.entry.rating))
                    .font(.subheadline)
                    .foregroundStyle(.primary)

                Spacer(minLength: 12)

                Text(self.detailText)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            #if targetEnvironment(macCatalyst)
            .frame(minHeight: appMinimumTouchTarget)
            #endif
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.tint.opacity(self.isSelected ? 0.12 : 0))
                    .padding(.horizontal, -8)
                    .padding(.vertical, -4)
            )
            .opacity(self.isAnyRatingSelected && self.isSelected == false ? 0.35 : 1.0)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        #if targetEnvironment(macCatalyst)
        .disabled(self.entry.count == 0)
        #endif
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        // An empty rating has no action; Mac already exposes it as a disabled button.
        #if !targetEnvironment(macCatalyst)
        .accessibilityRemoveTraits(self.entry.count > 0 ? [] : .isButton)
        #endif
        .accessibilityAddTraits(self.isSelected ? .isSelected : [])
        .accessibilityLabel(progressReviewRatingTitle(rating: self.entry.rating))
        .accessibilityValue(self.detailText)
    }

    private var detailText: String {
        "\(self.entry.count.formatted()) · \(progressReviewRatingPercentage(count: self.entry.count, totalReviewCount: self.entry.totalReviewCount))"
    }
}
