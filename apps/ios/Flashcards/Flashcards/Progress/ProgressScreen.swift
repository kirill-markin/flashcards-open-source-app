import Charts
import SwiftUI

private let progressStringsTableName: String = "Foundation"
private let progressCalendarColumnCount: Int = 7
private let progressChartHeight: CGFloat = 220
private let progressReviewScheduleChartHeight: CGFloat = 220
private let progressReviewScheduleLegendMarkerSize: CGFloat = 10
private let progressStreakBadgeSize: CGFloat = 34
private let progressStreakBadgeHorizontalPadding: CGFloat = 8
private let progressReviewCardsStringsTableName: String = "ReviewCards"

struct ProgressScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                if self.store.progressErrorMessage.isEmpty == false {
                    CopyableErrorMessageView(message: self.store.progressErrorMessage)
                        .modifier(ProgressCardModifier())
                }

                if let progressSnapshot = self.store.progressSnapshot {
                    let presentationCalendar = requiredProgressPresentationCalendar(
                        timeZoneIdentifier: progressSnapshot.scopeKey.timeZone
                    )
                    let streakWeeks = requiredProgressStreakWeeks(
                        progressSnapshot: progressSnapshot,
                        calendar: presentationCalendar
                    )
                    VStack(alignment: .leading, spacing: 12) {
                        Text(
                            String(
                                localized: "progress.screen.streak.section_title",
                                defaultValue: "Streak",
                                table: progressStringsTableName,
                                comment: "Progress streak section title"
                            )
                        )
                        .font(.headline)

                        ProgressStreakSection(
                            weeks: streakWeeks,
                            badgeState: makeReviewProgressBadgeState(summary: progressSnapshot.summary),
                            calendar: presentationCalendar
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.progressStreakSection)
                    .accessibilityValue(progressSummaryUITestValue(summary: progressSnapshot.summary))
                    .modifier(ProgressCardModifier())

                    VStack(alignment: .leading, spacing: 0) {
                        ProgressReviewsSection(
                            chartDays: progressSnapshot.chartData.chartDays,
                            chartCalendar: presentationCalendar,
                            selectionResetKey: progressSnapshot.scopeKey.storageKey
                        )
                    }
                    .accessibilityIdentifier(UITestIdentifier.progressReviewsSection)
                    .modifier(ProgressCardModifier())

                    if let reviewScheduleSnapshot = self.store.reviewScheduleSnapshot {
                        VStack(alignment: .leading, spacing: 0) {
                            ProgressReviewScheduleSection(snapshot: reviewScheduleSnapshot)
                        }
                        .accessibilityIdentifier(UITestIdentifier.progressReviewScheduleSection)
                        .modifier(ProgressCardModifier())
                    }
                } else if self.store.isProgressRefreshing == false {
                    VStack(alignment: .leading, spacing: 0) {
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
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .modifier(ProgressCardModifier())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .accessibilityIdentifier(UITestIdentifier.progressScreen)
        .navigationTitle(
            String(
                localized: "progress.screen.title",
                defaultValue: "Progress",
                table: progressStringsTableName,
                comment: "Progress screen title"
            )
        )
        .refreshable {
            await self.store.refreshProgressManually()
        }
    }
}

private func progressSummaryUITestValue(summary: ProgressSummary) -> String {
    let components: [String] = [
        "currentStreakDays=\(summary.currentStreakDays)",
        "hasReviewedToday=\(summary.hasReviewedToday ? "true" : "false")",
        "activeReviewDays=\(summary.activeReviewDays)"
    ]
    return components.joined(separator: ";")
}

private struct ProgressCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(uiColor: .secondarySystemGroupedBackground))
            )
    }
}

private struct ProgressStreakSection: View {
    let weeks: [ProgressCalendarWeek]
    let badgeState: ReviewProgressBadgeState
    let calendar: Calendar

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
                    Text(progressWeekdayLabel(date: day.date, calendar: self.calendar))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                }

                ForEach(self.streakDays) { day in
                    ProgressStreakDayCell(day: day, calendar: self.calendar)
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
    let calendar: Calendar

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
            return .accentColor
        }

        return self.day.isToday ? .accentColor : Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var borderColor: Color {
        if self.day.isFuturePlaceholder {
            return Color(uiColor: .separator).opacity(0.18)
        }

        if self.isActiveFlameDay {
            return .accentColor
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

        let dateTitle = progressCompleteDateLabel(date: self.day.date, calendar: self.calendar)
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
        makeProgressReviewChartPages(
            chartDays: self.chartDays,
            calendar: self.chartCalendar
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
                if visiblePage.hasReviewActivity {
                    Chart {
                        ForEach(visiblePage.days) { day in
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
                } else {
                    Text(
                        String(
                            localized: "progress.screen.reviews.empty",
                            defaultValue: "No reviews yet in this week.",
                            table: progressStringsTableName,
                            comment: "Progress reviews section empty caption"
                        )
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
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

private struct ProgressReviewScheduleSection: View {
    let snapshot: ReviewScheduleSnapshot

    @State private var selectedBucketKey: ReviewScheduleBucketKey?
    @State private var selectedAngle: Int?

    private var buckets: [ReviewScheduleBucket] {
        self.snapshot.schedule.buckets
    }

    private var nonEmptyBuckets: [ReviewScheduleBucket] {
        self.buckets.filter { bucket in
            bucket.count > 0
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(
                String(
                    localized: "progress.screen.review_schedule.section_title",
                    defaultValue: "Review schedule",
                    table: progressStringsTableName,
                    comment: "Progress review schedule section title"
                )
            )
            .font(.headline)

            if self.snapshot.schedule.totalCards > 0 {
                Chart {
                    ForEach(self.nonEmptyBuckets) { bucket in
                        SectorMark(
                            angle: .value("Cards", bucket.count),
                            innerRadius: .ratio(0.62),
                            outerRadius: .ratio(self.outerRadiusRatio(for: bucket.key))
                        )
                        .foregroundStyle(progressReviewScheduleBucketColor(key: bucket.key))
                        .opacity(self.segmentOpacity(for: bucket.key))
                        .accessibilityLabel(progressReviewScheduleBucketTitle(key: bucket.key))
                        .accessibilityValue(
                            progressReviewScheduleBucketAccessibilityValue(
                                bucket: bucket,
                                totalCards: self.snapshot.schedule.totalCards
                            )
                        )
                    }
                }
                .chartLegend(.hidden)
                .chartAngleSelection(value: self.$selectedAngle)
                .frame(height: progressReviewScheduleChartHeight)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(progressReviewScheduleChartAccessibilityLabel())
                .accessibilityValue(self.chartAccessibilityValue)
                .onChange(of: self.selectedAngle) { _, newValue in
                    self.handleChartAngleSelection(newValue)
                }

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(self.buckets) { bucket in
                        ProgressReviewScheduleLegendRow(
                            bucket: bucket,
                            totalCards: self.snapshot.schedule.totalCards,
                            isSelected: self.selectedBucketKey == bucket.key,
                            isAnySelected: self.selectedBucketKey != nil,
                            onTap: { self.toggleSelection(for: bucket.key) }
                        )
                    }
                }
            } else {
                Text(
                    String(
                        localized: "progress.screen.review_schedule.empty",
                        defaultValue: "No active cards yet.",
                        table: progressStringsTableName,
                        comment: "Progress review schedule empty caption"
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .background(
            // Background tap layer — only fires when no foreground view (chart, legend row)
            // claims the tap, so it doesn't compete with the Charts framework's selection gesture.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    self.selectedBucketKey = nil
                }
        )
    }

    private var chartAccessibilityValue: String {
        let summary = progressReviewScheduleAccessibilitySummary(snapshot: self.snapshot)
        guard let selected = self.selectedBucketKey else {
            return summary
        }
        let selectedTitle = progressReviewScheduleBucketTitle(key: selected)
        return "\(selectedTitle), \(summary)"
    }

    private func isDimmed(_ key: ReviewScheduleBucketKey) -> Bool {
        guard let selected = self.selectedBucketKey else {
            return false
        }
        return selected != key
    }

    private func segmentOpacity(for key: ReviewScheduleBucketKey) -> Double {
        self.isDimmed(key) ? 0.35 : 1.0
    }

    private func outerRadiusRatio(for key: ReviewScheduleBucketKey) -> Double {
        self.isDimmed(key) ? 0.94 : 1.0
    }

    private func toggleSelection(for key: ReviewScheduleBucketKey) {
        if self.selectedBucketKey == key {
            self.selectedBucketKey = nil
        } else {
            self.selectedBucketKey = key
        }
    }

    private func handleChartAngleSelection(_ angleValue: Int?) {
        guard let angleValue else {
            return
        }
        let totalCards = self.snapshot.schedule.totalCards
        guard totalCards > 0 else {
            return
        }
        let tappedKey = bucketKeyForChartAngle(
            angleValue: angleValue,
            buckets: self.nonEmptyBuckets
        )
        guard let tappedKey else {
            return
        }
        self.toggleSelection(for: tappedKey)
        // Reset so a tap on the same segment fires another onChange (toggle-off).
        self.selectedAngle = nil
    }
}

// Boundary policy: an exact tap on a wedge boundary maps to the earlier wedge.
// Pure mapping from a Swift Charts angle-selection value (running cards count)
// to the bucket whose wedge it falls inside.
private func bucketKeyForChartAngle(
    angleValue: Int,
    buckets: [ReviewScheduleBucket]
) -> ReviewScheduleBucketKey? {
    guard buckets.isEmpty == false else {
        return nil
    }
    var runningTotal: Int = 0
    for bucket in buckets {
        runningTotal += bucket.count
        if angleValue <= runningTotal {
            return bucket.key
        }
    }
    assertionFailure("bucketKeyForChartAngle: angleValue \(angleValue) exceeded running total \(runningTotal); Charts may have changed its angle-binding clamping behavior")
    return buckets.last?.key
}

private struct ProgressReviewScheduleLegendRow: View {
    let bucket: ReviewScheduleBucket
    let totalCards: Int
    let isSelected: Bool
    let isAnySelected: Bool
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(progressReviewScheduleBucketColor(key: self.bucket.key))
                .frame(
                    width: progressReviewScheduleLegendMarkerSize,
                    height: progressReviewScheduleLegendMarkerSize
                )
                .accessibilityHidden(true)

            Text(progressReviewScheduleBucketTitle(key: self.bucket.key))
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
        .opacity(self.isAnySelected && self.isSelected == false ? 0.35 : 1.0)
        .contentShape(Rectangle())
        .onTapGesture {
            guard self.bucket.count > 0 else {
                return
            }
            self.onTap()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(self.bucket.count > 0 ? .isButton : [])
        .accessibilityLabel(progressReviewScheduleBucketTitle(key: self.bucket.key))
        .accessibilityValue(
            progressReviewScheduleBucketAccessibilityValue(
                bucket: self.bucket,
                totalCards: self.totalCards
            )
        )
    }

    private var detailText: String {
        "\(self.bucket.count.formatted()) · \(progressReviewScheduleBucketPercentage(bucket: self.bucket, totalCards: self.totalCards))"
    }
}

private struct ProgressReviewChartPage: Identifiable {
    let days: [ProgressChartDay]
    let startLocalDate: String
    let startDate: Date
    let endDate: Date

    init(days: [ProgressChartDay]) {
        guard let firstDay = days.first, let lastDay = days.last else {
            preconditionFailure("Progress review chart page must contain at least one day")
        }

        self.days = days
        self.startLocalDate = firstDay.localDate
        self.startDate = firstDay.date
        self.endDate = lastDay.date
    }

    var id: String {
        self.startLocalDate
    }

    var hasReviewActivity: Bool {
        self.days.contains(where: { day in
            day.reviewCount > 0
        })
    }

    var xAxisValues: [String] {
        self.days.map(\.localDate)
    }

    func day(localDate: String) -> ProgressChartDay? {
        self.days.first(where: { day in
            day.localDate == localDate
        })
    }
}

private struct ProgressReviewChartSelectionResetToken: Equatable {
    let selectionResetKey: String
    let chartDays: [ProgressChartDay]
}

private func makeProgressReviewChartPages(
    chartDays: [ProgressChartDay],
    calendar: Calendar
) -> [ProgressReviewChartPage] {
    guard chartDays.isEmpty == false else {
        return []
    }

    var pages: [ProgressReviewChartPage] = []
    var currentPageDays: [ProgressChartDay] = []
    var currentWeekStart: Date? = nil

    for day in chartDays {
        guard let weekInterval = calendar.dateInterval(of: .weekOfYear, for: day.date) else {
            preconditionFailure("Expected a week interval for progress review chart day")
        }

        let weekStart = calendar.startOfDay(for: weekInterval.start)
        if let activeWeekStart = currentWeekStart, activeWeekStart != weekStart {
            pages.append(ProgressReviewChartPage(days: currentPageDays))
            currentPageDays = [day]
            currentWeekStart = weekStart
            continue
        }

        currentPageDays.append(day)
        currentWeekStart = weekStart
    }

    if currentPageDays.isEmpty == false {
        pages.append(ProgressReviewChartPage(days: currentPageDays))
    }

    return pages
}

private func progressReviewChartPageDateRange(
    page: ProgressReviewChartPage,
    calendar: Calendar
) -> String {
    let formatter = DateIntervalFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateStyle = .medium
    formatter.timeStyle = .none
    return formatter.string(from: page.startDate, to: page.endDate)
}

private func requiredProgressPresentationCalendar(
    timeZoneIdentifier: String
) -> Calendar {
    do {
        return try makeProgressPresentationCalendar(
            timeZoneIdentifier: timeZoneIdentifier,
            userCalendar: Calendar.autoupdatingCurrent
        )
    } catch {
        preconditionFailure("Progress presentation calendar is invalid: \(error.localizedDescription)")
    }
}

private func requiredProgressStreakWeeks(
    progressSnapshot: ProgressSnapshot,
    calendar: Calendar
) -> [ProgressCalendarWeek] {
    do {
        return try makeProgressStreakWeeks(
            chartDays: progressSnapshot.chartData.chartDays,
            rangeStartLocalDate: progressSnapshot.scopeKey.from,
            todayLocalDate: progressSnapshot.scopeKey.to,
            calendar: calendar
        )
    } catch {
        preconditionFailure("Progress streak weeks are invalid: \(error.localizedDescription)")
    }
}

private func progressWeekdayLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.setLocalizedDateFormatFromTemplate("EEEEE")
    return formatter.string(from: date)
}

private func progressCompleteDateLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateStyle = .full
    formatter.timeStyle = .none
    return formatter.string(from: date)
}

private func progressReviewChartDayLabel(date: Date, calendar: Calendar) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale.autoupdatingCurrent
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "d"
    return formatter.string(from: date)
}

private func progressChartBarStyle(day: ProgressChartDay) -> AnyShapeStyle {
    if day.reviewCount > 0 && day.isToday {
        return AnyShapeStyle(Color.accentColor)
    }

    if day.reviewCount > 0 {
        return AnyShapeStyle(Color.accentColor)
    }

    if day.isToday {
        return AnyShapeStyle(Color.accentColor)
    }

    return AnyShapeStyle(Color(uiColor: .tertiarySystemFill))
}

private func progressReviewScheduleBucketTitle(key: ReviewScheduleBucketKey) -> String {
    switch key {
    case .new:
        return String(
            localized: "progress.screen.review_schedule.bucket.new",
            defaultValue: "New",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards without a due date"
        )
    case .today:
        return String(
            localized: "progress.screen.review_schedule.bucket.today",
            defaultValue: "Today",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for overdue and due-today cards"
        )
    case .days1To7:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_1_to_7",
            defaultValue: "1-7 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in one to seven days"
        )
    case .days8To30:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_8_to_30",
            defaultValue: "8-30 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in eight to thirty days"
        )
    case .days31To90:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_31_to_90",
            defaultValue: "31-90 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in thirty-one to ninety days"
        )
    case .days91To360:
        return String(
            localized: "progress.screen.review_schedule.bucket.days_91_to_360",
            defaultValue: "91-360 days",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in ninety-one to three hundred sixty days"
        )
    case .years1To2:
        return String(
            localized: "progress.screen.review_schedule.bucket.years_1_to_2",
            defaultValue: "1-2 years",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due in one to two years"
        )
    case .later:
        return String(
            localized: "progress.screen.review_schedule.bucket.later",
            defaultValue: "Later",
            table: progressStringsTableName,
            comment: "Review schedule bucket label for cards due later than two years"
        )
    }
}

// Canonical palette — see docs/progress-pie-palette.md.
// Keep the hex values in sync with the Android and Web clients.
private func progressReviewScheduleBucketColor(key: ReviewScheduleBucketKey) -> Color {
    switch key {
    case .new:
        return Color(red: 0xE6 / 255, green: 0x9F / 255, blue: 0x00 / 255)
    case .today:
        return Color(red: 0xD7 / 255, green: 0x26 / 255, blue: 0x3D / 255)
    case .days1To7:
        return Color(red: 0xF2 / 255, green: 0xA6 / 255, blue: 0x5A / 255)
    case .days8To30:
        return Color(red: 0x2B / 255, green: 0xB6 / 255, blue: 0x73 / 255)
    case .days31To90:
        return Color(red: 0x1F / 255, green: 0xB5 / 255, blue: 0xC1 / 255)
    case .days91To360:
        return Color(red: 0x3F / 255, green: 0x7C / 255, blue: 0xC8 / 255)
    case .years1To2:
        return Color(red: 0x8E / 255, green: 0x5B / 255, blue: 0xD9 / 255)
    case .later:
        return Color(red: 0x7A / 255, green: 0x80 / 255, blue: 0x88 / 255)
    }
}

private func progressReviewScheduleBucketPercentage(
    bucket: ReviewScheduleBucket,
    totalCards: Int
) -> String {
    guard totalCards > 0 else {
        return Double(0).formatted(.percent.precision(.fractionLength(0)))
    }

    let ratio = Double(bucket.count) / Double(totalCards)
    return ratio.formatted(.percent.precision(.fractionLength(0)))
}

private func progressReviewScheduleChartAccessibilityLabel() -> String {
    String(
        localized: "progress.screen.review_schedule.section_title",
        defaultValue: "Review schedule",
        table: progressStringsTableName,
        comment: "Progress review schedule section title"
    )
}

private func progressReviewScheduleBucketAccessibilityValue(
    bucket: ReviewScheduleBucket,
    totalCards: Int
) -> String {
    let localizedFormat = String(
        localized: "progress.screen.review_schedule.bucket.accessibility_value",
        defaultValue: "%lld cards, %@",
        table: progressStringsTableName,
        comment: "Accessibility value for a review schedule bucket with card count and percentage"
    )
    return String(
        format: localizedFormat,
        locale: Locale.current,
        Int64(bucket.count),
        progressReviewScheduleBucketPercentage(bucket: bucket, totalCards: totalCards)
    )
}

private func progressReviewScheduleAccessibilitySummary(snapshot: ReviewScheduleSnapshot) -> String {
    snapshot.schedule.buckets.map { bucket in
        "\(progressReviewScheduleBucketTitle(key: bucket.key)): \(progressReviewScheduleBucketAccessibilityValue(bucket: bucket, totalCards: snapshot.schedule.totalCards))"
    }
    .joined(separator: ", ")
}

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
    }
}
