import Charts
import SwiftUI

private let progressStringsTableName: String = "Foundation"
private let progressCalendarColumnCount: Int = 7
private let progressChartDayWidth: CGFloat = 20
private let progressChartHeight: CGFloat = 220
private let progressReviewsChartScrollTargetID: String = "progress-reviews-chart"
private let progressStreakBadgeSize: CGFloat = 34
private let progressStreakBadgeHorizontalPadding: CGFloat = 8
private let progressReviewCardsStringsTableName: String = "ReviewCards"

struct ProgressScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel

    var body: some View {
        List {
            if self.store.progressErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.store.progressErrorMessage)
                }
            }

            if self.store.isProgressRefreshing && self.store.progressSnapshot == nil {
                Section {
                    ProgressView(
                        String(
                            localized: "progress.screen.loading",
                            defaultValue: "Loading progress...",
                            table: progressStringsTableName,
                            comment: "Progress loading state"
                        )
                    )
                }
            }

            if let progressSnapshot = self.store.progressSnapshot {
                if self.store.isProgressRefreshing {
                    Section {
                        ProgressView(
                            String(
                                localized: "progress.screen.loading",
                                defaultValue: "Loading progress...",
                                table: progressStringsTableName,
                                comment: "Progress loading state"
                            )
                        )
                    }
                }

                Section(
                    String(
                        localized: "progress.screen.streak.section_title",
                        defaultValue: "Streak",
                        table: progressStringsTableName,
                        comment: "Progress streak section title"
                    )
                ) {
                    ProgressStreakSection(
                        weeks: progressSnapshot.streakWeeks,
                        badgeState: makeReviewProgressBadgeState(summary: progressSnapshot.summary)
                    )
                }

                Section(
                    String(
                        localized: "progress.screen.reviews.section_title",
                        defaultValue: "Reviews",
                        table: progressStringsTableName,
                        comment: "Progress reviews section title"
                    )
                ) {
                    ProgressReviewsSection(
                        chartDays: progressSnapshot.chartData.chartDays,
                        chartUpperBound: progressSnapshot.chartData.chartUpperBound,
                        hasReviewActivity: progressSnapshot.chartData.hasReviewActivity
                    )
                }
            } else if self.store.isProgressRefreshing == false {
                Section {
                    ContentUnavailableView(
                        String(
                            localized: "progress.screen.unavailable.title",
                            defaultValue: "Progress is unavailable",
                            table: progressStringsTableName,
                            comment: "Progress unavailable title"
                        ),
                        systemImage: "chart.bar.xaxis",
                        description: Text(
                            String(
                                localized: "progress.screen.unavailable.description",
                                defaultValue: "Open review or reconnect cloud data, then refresh progress.",
                                table: progressStringsTableName,
                                comment: "Progress unavailable description"
                            )
                        )
                    )
                }
            }
        }
        .listStyle(.insetGrouped)
        .accessibilityIdentifier(UITestIdentifier.progressScreen)
        .navigationTitle(
            String(
                localized: "progress.screen.title",
                defaultValue: "Progress",
                table: progressStringsTableName,
                comment: "Progress screen title"
            )
        )
        .task {
            await self.store.refreshProgressIfNeeded()
        }
        .onChange(of: self.navigation.selectedTab) { _, nextTab in
            guard nextTab == .progress else {
                return
            }

            Task { @MainActor in
                await self.store.refreshProgressIfNeeded()
            }
        }
        .refreshable {
            await self.store.refreshProgressManually()
        }
    }
}

private struct ProgressStreakSection: View {
    let weeks: [ProgressCalendarWeek]
    let badgeState: ReviewProgressBadgeState

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .center), count: progressCalendarColumnCount)
    }

    private var headerDays: [ProgressCalendarDay] {
        self.weeks.first?.days ?? []
    }

    private var streakDays: [ProgressCalendarDay] {
        self.weeks.flatMap(\.days)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                ProgressStreakSummaryBadge(badgeState: self.badgeState)
                Spacer(minLength: 0)
            }

            LazyVGrid(columns: self.columns, spacing: 12) {
                ForEach(self.headerDays) { day in
                    Text(day.date, format: .dateTime.weekday(.narrow))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                }

                ForEach(self.streakDays) { day in
                    ProgressStreakDayCell(day: day)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ProgressStreakSummaryBadge: View {
    let badgeState: ReviewProgressBadgeState

    private var presentation: ReviewProgressBadgePresentation {
        makeReviewProgressBadgePresentation(badgeState: self.badgeState)
    }

    var body: some View {
        ZStack {
            Capsule()
                .fill(Color(uiColor: .secondarySystemBackground))

            Capsule()
                .strokeBorder(self.presentation.borderColor, lineWidth: 1)

            HStack(spacing: 3) {
                Image(systemName: self.presentation.iconSystemName)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(self.presentation.iconColor)

                Text(formatReviewProgressBadgeValue(badgeState: self.badgeState))
                    .font(.caption2.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(self.presentation.textColor)
                    .minimumScaleFactor(0.65)
            }
            .padding(.horizontal, progressStreakBadgeHorizontalPadding)
        }
        .frame(minHeight: progressStreakBadgeSize)
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.accessibilityLabel)
    }

    private var accessibilityLabel: String {
        let localizedFormat: String
        if self.badgeState.hasReviewedToday {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.reviewed_today",
                defaultValue: "Review streak %@ days. Reviewed today.",
                table: progressReviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has reviewed today"
            )
        } else {
            localizedFormat = String(
                localized: "review.progress_badge.accessibility.not_reviewed_today",
                defaultValue: "Review streak %@ days. Not reviewed today.",
                table: progressReviewCardsStringsTableName,
                comment: "Accessibility label for the review progress badge when the user has not reviewed today"
            )
        }

        return String(
            format: localizedFormat,
            locale: Locale.current,
            self.badgeState.streakDays.formatted()
        )
    }
}

private struct ProgressStreakDayCell: View {
    let day: ProgressCalendarDay

    var body: some View {
        ZStack {
            Circle()
                .fill(self.backgroundColor)

            Circle()
                .stroke(self.borderColor, lineWidth: self.borderLineWidth)

            if self.day.isFuturePlaceholder {
                Circle()
                    .fill(Color(uiColor: .tertiarySystemGroupedBackground))
                    .frame(width: 8, height: 8)
            } else if self.isActiveFlameDay {
                Image(systemName: "flame.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(self.foregroundColor)
            } else {
                Text(self.day.dayNumber.formatted())
                    .font(.footnote.weight(self.day.isToday ? .semibold : .regular))
                    .monospacedDigit()
                    .foregroundStyle(self.foregroundColor)
            }
        }
        .frame(width: 38, height: 38)
        .accessibilityElement(children: .ignore)
        .accessibilityHidden(self.day.isFuturePlaceholder)
        .accessibilityLabel(self.accessibilityLabel)
    }

    private var backgroundColor: Color {
        if self.day.isFuturePlaceholder {
            return Color.clear
        }

        if self.isActiveFlameDay {
            return .orange
        }

        return self.day.isToday ? .accentColor : Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var borderColor: Color {
        if self.day.isFuturePlaceholder {
            return Color(uiColor: .separator).opacity(0.18)
        }

        if self.isActiveFlameDay {
            return .orange
        }

        if self.day.isToday {
            return Color.white.opacity(0.92)
        }

        return Color(uiColor: .separator).opacity(0.35)
    }

    private var foregroundColor: Color {
        if self.day.isFuturePlaceholder {
            return .secondary
        }

        if self.isActiveFlameDay {
            return .white
        }

        if self.day.isToday {
            return .white
        }

        return .primary
    }

    private var isActiveFlameDay: Bool {
        self.day.reviewCount > 0
    }

    private var borderLineWidth: CGFloat {
        self.day.isToday && self.isActiveFlameDay == false ? 2 : 1
    }

    private var accessibilityLabel: String {
        if self.day.isFuturePlaceholder {
            return ""
        }

        let dateTitle = self.day.date.formatted(date: .complete, time: .omitted)
        let todayTitle = String(
            localized: "progress.screen.today",
            defaultValue: "Today",
            table: progressStringsTableName,
            comment: "Progress today label"
        )
        let reviewsTitle = String.localizedStringWithFormat(
            String(
                localized: "progress.screen.reviews.accessibility",
                defaultValue: "%lld reviews",
                table: progressStringsTableName,
                comment: "Accessibility label suffix for daily review counts"
            ),
            Int64(self.day.reviewCount)
        )

        if self.day.isToday {
            return "\(dateTitle), \(todayTitle), \(reviewsTitle)"
        }

        return "\(dateTitle), \(reviewsTitle)"
    }
}

private struct ProgressReviewsSection: View {
    let chartDays: [ProgressChartDay]
    let chartUpperBound: Int
    let hasReviewActivity: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        Chart {
                            ForEach(self.chartDays) { day in
                                BarMark(
                                    x: .value("Date", day.date, unit: .day),
                                    y: .value("Reviews", day.reviewCount)
                                )
                                .foregroundStyle(progressChartBarStyle(day: day))

                                if day.isToday {
                                    RuleMark(x: .value("Today", day.date, unit: .day))
                                        .foregroundStyle(Color.accentColor.opacity(0.35))
                                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                }
                            }
                        }
                        .chartXScale(domain: self.chartDomain)
                        .chartYScale(domain: 0 ... self.chartUpperBound)
                        .chartXAxis {
                            AxisMarks(values: .stride(by: .day, count: 7)) { value in
                                AxisGridLine()
                                    .foregroundStyle(Color(uiColor: .separator).opacity(0.18))
                                AxisTick()
                                    .foregroundStyle(Color(uiColor: .separator).opacity(0.35))
                                AxisValueLabel(format: .dateTime.month(.abbreviated).day())
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
                        .frame(
                            width: progressChartWidth(
                                containerWidth: geometry.size.width,
                                dayCount: self.chartDays.count
                            ),
                            height: progressChartHeight
                        )
                        .id(progressReviewsChartScrollTargetID)
                    }
                    .onAppear {
                        scrollProgressChartToToday(proxy: proxy)
                    }
                    .onChange(of: self.chartDays.last?.id) { _, _ in
                        scrollProgressChartToToday(proxy: proxy)
                    }
                }
            }
            .frame(height: progressChartHeight)

            if self.hasReviewActivity == false {
                Text(
                    String(
                        localized: "progress.screen.reviews.empty",
                        defaultValue: "No reviews yet in this period.",
                        table: progressStringsTableName,
                        comment: "Progress reviews section empty caption"
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var chartDomain: ClosedRange<Date> {
        guard let firstDate = self.chartDays.first?.date, let lastDate = self.chartDays.last?.date else {
            let now = Date()
            return now ... now
        }

        return firstDate ... lastDate
    }
}

private func progressChartWidth(containerWidth: CGFloat, dayCount: Int) -> CGFloat {
    max(containerWidth, CGFloat(dayCount) * progressChartDayWidth)
}

private func progressChartBarStyle(day: ProgressChartDay) -> AnyShapeStyle {
    if day.reviewCount > 0 {
        return AnyShapeStyle(Color.accentColor.gradient)
    }

    return AnyShapeStyle(Color.accentColor.opacity(0.16))
}

private func scrollProgressChartToToday(proxy: ScrollViewProxy) {
    proxy.scrollTo(progressReviewsChartScrollTargetID, anchor: .trailing)
}

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
    }
}
