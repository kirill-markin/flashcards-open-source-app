import Charts
import SwiftUI

private let progressChartHeight: CGFloat = 220

struct ProgressReviewsSection: View {
    let chartDays: [ProgressChartDay]
    let chartCalendar: Calendar
    let selectionResetKey: String
    @State private var selectedPageStartLocalDate: String? = nil

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

    private var visiblePageUpperBound: Int {
        guard let visiblePage else {
            return 1
        }

        let maximumReviewCount = visiblePage.days.map(\.reviewCount).max() ?? 0
        return progressChartUpperBound(maximumReviewCount: maximumReviewCount)
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

                    if let visiblePage = self.visiblePage {
                        Text(
                            progressReviewChartPageDateRange(
                                page: visiblePage,
                                calendar: self.chartCalendar
                            )
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
                        BarMark(
                            x: .value("Day", day.localDate),
                            y: .value("Reviews", day.reviewCount)
                        )
                        .foregroundStyle(progressChartBarStyle(day: day))
                    }
                }
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
            }
        }
        .padding(.vertical, 4)
        .onChange(of: self.pageSelectionResetToken) { _, _ in
            self.selectedPageStartLocalDate = nil
        }
    }

    private func showPreviousPage() {
        guard self.selectedPageIndex > 0 else {
            return
        }

        self.selectedPageStartLocalDate = self.chartPages[self.selectedPageIndex - 1].startLocalDate
    }

    private func showNextPage() {
        guard self.selectedPageIndex < self.chartPages.count - 1 else {
            return
        }

        self.selectedPageStartLocalDate = self.chartPages[self.selectedPageIndex + 1].startLocalDate
    }
}
