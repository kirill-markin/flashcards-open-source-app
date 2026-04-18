import Charts
import SwiftUI

private let progressStringsTableName: String = "Foundation"
private let progressCalendarColumnCount: Int = 7
private let progressChartDayWidth: CGFloat = 20
private let progressChartHeight: CGFloat = 220
private let progressReviewsChartScrollTargetID: String = "progress-reviews-chart"

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

                Section {
                    ProgressSourceStateView(snapshot: progressSnapshot)
                }

                Section(
                    String(
                        localized: "progress.screen.streak.section_title",
                        defaultValue: "Streak",
                        table: progressStringsTableName,
                        comment: "Progress streak section title"
                    )
                ) {
                    ProgressStreakSection(weeks: progressSnapshot.streakWeeks)
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

private struct ProgressSourceStateView: View {
    let snapshot: ProgressSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: self.symbolName)
                .foregroundStyle(.secondary)
                .font(.body.weight(.semibold))
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(self.title)
                    .font(.subheadline.weight(.semibold))
                Text(self.description)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var symbolName: String {
        switch (self.snapshot.summarySourceState, self.snapshot.seriesSourceState) {
        case (.localOnly, .localOnly):
            return "iphone"
        case (.serverBase, .serverBase):
            return "icloud"
        case (.serverBaseWithPendingLocalOverlay, .serverBaseWithPendingLocalOverlay):
            return "arrow.triangle.2.circlepath.icloud"
        case (.serverBaseWithPendingLocalOverlay, _), (_, .serverBaseWithPendingLocalOverlay):
            return "arrow.triangle.2.circlepath"
        default:
            return "square.2.layers.3d.top.filled"
        }
    }

    private var title: String {
        switch (self.snapshot.summarySourceState, self.snapshot.seriesSourceState) {
        case (.localOnly, .localOnly):
            return String(
                localized: "progress.screen.source.local_only.title",
                defaultValue: "Local progress only",
                table: progressStringsTableName,
                comment: "Progress local-only source title"
            )
        case (.serverBase, .serverBase):
            return String(
                localized: "progress.screen.source.server_base.title",
                defaultValue: "Cloud progress",
                table: progressStringsTableName,
                comment: "Progress server-base source title"
            )
        case (.serverBaseWithPendingLocalOverlay, .serverBaseWithPendingLocalOverlay):
            return String(
                localized: "progress.screen.source.server_overlay.title",
                defaultValue: "Cloud progress with local updates",
                table: progressStringsTableName,
                comment: "Progress server-plus-overlay source title"
            )
        case (.serverBase, .localOnly), (.serverBaseWithPendingLocalOverlay, .localOnly):
            return String(
                localized: "progress.screen.source.mixed.summary_cloud.title",
                defaultValue: "Cloud summary, local chart",
                table: progressStringsTableName,
                comment: "Progress mixed source title when summary is remote and chart is local"
            )
        case (.localOnly, .serverBase), (.localOnly, .serverBaseWithPendingLocalOverlay):
            return String(
                localized: "progress.screen.source.mixed.chart_cloud.title",
                defaultValue: "Local summary, cloud chart",
                table: progressStringsTableName,
                comment: "Progress mixed source title when summary is local and chart is remote"
            )
        default:
            return String(
                localized: "progress.screen.source.mixed.title",
                defaultValue: "Mixed progress sources",
                table: progressStringsTableName,
                comment: "Progress mixed source title"
            )
        }
    }

    private var description: String {
        switch (self.snapshot.summarySourceState, self.snapshot.seriesSourceState) {
        case (.localOnly, .localOnly):
            return String(
                localized: "progress.screen.source.local_only.description",
                defaultValue: "Showing progress from this device until cloud data is available.",
                table: progressStringsTableName,
                comment: "Progress local-only source description"
            )
        case (.serverBase, .serverBase):
            return String(
                localized: "progress.screen.source.server_base.description",
                defaultValue: "Showing the latest cached cloud progress for this account.",
                table: progressStringsTableName,
                comment: "Progress server-base source description"
            )
        case (.serverBaseWithPendingLocalOverlay, .serverBaseWithPendingLocalOverlay):
            return String(
                localized: "progress.screen.source.server_overlay.description",
                defaultValue: "Showing cached cloud progress plus pending local reviews that have not synced yet.",
                table: progressStringsTableName,
                comment: "Progress server-plus-overlay source description"
            )
        default:
            return String(
                localized: "progress.screen.source.mixed.description",
                defaultValue: "Summary: \(self.sourceStateDescription(self.snapshot.summarySourceState)). Chart: \(self.sourceStateDescription(self.snapshot.seriesSourceState)).",
                table: progressStringsTableName,
                comment: "Progress mixed source description"
            )
        }
    }

    private func sourceStateDescription(_ state: ProgressSourceState) -> String {
        switch state {
        case .localOnly:
            return String(
                localized: "progress.screen.source.mixed.local",
                defaultValue: "local device data",
                table: progressStringsTableName,
                comment: "Progress mixed source local segment"
            )
        case .serverBase:
            return String(
                localized: "progress.screen.source.mixed.server",
                defaultValue: "cached cloud data",
                table: progressStringsTableName,
                comment: "Progress mixed source cloud segment"
            )
        case .serverBaseWithPendingLocalOverlay:
            return String(
                localized: "progress.screen.source.mixed.server_overlay",
                defaultValue: "cached cloud data with pending local reviews",
                table: progressStringsTableName,
                comment: "Progress mixed source cloud overlay segment"
            )
        }
    }
}

private struct ProgressStreakSection: View {
    let weeks: [ProgressCalendarWeek]

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
        .padding(.vertical, 4)
    }
}

private struct ProgressStreakDayCell: View {
    let day: ProgressCalendarDay

    var body: some View {
        ZStack {
            Circle()
                .fill(self.backgroundColor)

            Circle()
                .stroke(self.borderColor, lineWidth: self.day.isToday ? 2 : 1)

            if self.day.isFuturePlaceholder {
                Circle()
                    .fill(Color(uiColor: .tertiarySystemGroupedBackground))
                    .frame(width: 8, height: 8)
            } else if self.day.reviewCount > 0 {
                Image(systemName: "checkmark")
                    .font(.caption.weight(.bold))
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

        if self.day.reviewCount > 0 {
            return self.day.isToday ? .accentColor : Color.accentColor.opacity(0.22)
        }

        return self.day.isToday ? .accentColor : Color(uiColor: .secondarySystemGroupedBackground)
    }

    private var borderColor: Color {
        if self.day.isFuturePlaceholder {
            return Color(uiColor: .separator).opacity(0.18)
        }

        if self.day.isToday {
            return Color.white.opacity(0.92)
        }

        if self.day.reviewCount > 0 {
            return Color.accentColor.opacity(0.35)
        }

        return Color(uiColor: .separator).opacity(0.35)
    }

    private var foregroundColor: Color {
        if self.day.isFuturePlaceholder {
            return .secondary
        }

        if self.day.isToday {
            return .white
        }

        return self.day.reviewCount > 0 ? .accentColor : .primary
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
    if day.isToday {
        return AnyShapeStyle(Color.accentColor.gradient)
    }

    return AnyShapeStyle(Color.accentColor.opacity(0.35))
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
