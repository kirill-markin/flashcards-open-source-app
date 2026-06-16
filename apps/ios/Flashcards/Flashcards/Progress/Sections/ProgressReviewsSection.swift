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
    let chartCalendar: Calendar
    let selectionResetKey: String
    @State private var selectedPageStartLocalDate: String? = nil
    @State private var selection: ProgressReviewsSelection? = nil

    private var pageSelectionResetToken: ProgressReviewChartSelectionResetToken {
        ProgressReviewChartSelectionResetToken(
            selectionResetKey: self.selectionResetKey,
            chartDays: self.chartDays
        )
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
        return progressChartUpperBound(maximumReviewCount: maximumReviewCount)
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
                            table: progressStringsTableName,
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
                                .frame(minWidth: 28, minHeight: 28)
                        }
                        .disabled(self.selectedPageIndex == 0)
                        .accessibilityLabel(
                            String(
                                localized: "progress.screen.reviews.previous_week",
                                defaultValue: "Previous week",
                                table: progressStringsTableName,
                                comment: "Accessibility label for the previous reviews week button"
                            )
                        )

                        Button(action: self.showNextPage) {
                            Image(systemName: "chevron.forward")
                                .font(.body.weight(.semibold))
                                .frame(minWidth: 28, minHeight: 28)
                        }
                        .disabled(self.selectedPageIndex >= self.chartPages.count - 1)
                        .accessibilityLabel(
                            String(
                                localized: "progress.screen.reviews.next_week",
                                defaultValue: "Next week",
                                table: progressStringsTableName,
                                comment: "Accessibility label for the next reviews week button"
                            )
                        )
                    }
                }
            }

            if let visiblePage = self.visiblePage {
                Chart {
                    ForEach(visiblePage.days) { day in
                        if day.isToday && day.reviewCount == 0 {
                            RectangleMark(
                                x: .value("Day", day.localDate),
                                yStart: .value("Floor", 0),
                                yEnd: .value("Ceiling", self.visiblePageUpperBound)
                            )
                            .foregroundStyle(Color.accentColor.opacity(0.12))
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
            self.selectedPageStartLocalDate = nil
            self.selection = nil
        }
    }

    private func showPreviousPage() {
        guard self.selectedPageIndex > 0 else {
            return
        }

        self.selectedPageStartLocalDate = self.chartPages[self.selectedPageIndex - 1].startLocalDate
        self.selection = nil
    }

    private func showNextPage() {
        guard self.selectedPageIndex < self.chartPages.count - 1 else {
            return
        }

        self.selectedPageStartLocalDate = self.chartPages[self.selectedPageIndex + 1].startLocalDate
        self.selection = nil
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
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(self.isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
                .padding(.horizontal, -8)
                .padding(.vertical, -4)
        )
        .opacity(self.isAnyRatingSelected && self.isSelected == false ? 0.35 : 1.0)
        .contentShape(Rectangle())
        .onTapGesture {
            guard self.entry.count > 0 else {
                return
            }

            self.onTap()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(self.entry.count > 0 ? .isButton : [])
        .accessibilityLabel(progressReviewRatingTitle(rating: self.entry.rating))
        .accessibilityValue(self.detailText)
    }

    private var detailText: String {
        "\(self.entry.count.formatted()) · \(progressReviewRatingPercentage(count: self.entry.count, totalReviewCount: self.entry.totalReviewCount))"
    }
}
