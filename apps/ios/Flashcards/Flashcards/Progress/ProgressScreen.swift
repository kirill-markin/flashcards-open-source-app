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

    @State private var progressPresentation: ProgressPresentation?
    @State private var screenErrorMessage: String = ""
    @State private var isLoading: Bool = false
    @State private var nextReloadRequestSequence: Int = 0

    private var reloadTaskID: String {
        let cloudState = self.store.cloudSettings?.cloudState.rawValue ?? "none"
        let linkedUserId = self.store.cloudSettings?.linkedUserId ?? ""
        let activeWorkspaceId = self.store.cloudSettings?.activeWorkspaceId ?? ""
        return "\(cloudState)|\(linkedUserId)|\(activeWorkspaceId)"
    }

    var body: some View {
        List {
            if self.screenErrorMessage.isEmpty == false {
                Section {
                    CopyableErrorMessageView(message: self.screenErrorMessage)
                }
            }

            if progressIsUnavailable(cloudState: self.store.cloudSettings?.cloudState) {
                Section {
                    ContentUnavailableView(
                        String(
                            localized: "progress.screen.sign_in_required.title",
                            defaultValue: "Cloud progress is unavailable",
                            table: progressStringsTableName,
                            comment: "Progress sign-in-required title"
                        ),
                        systemImage: "person.crop.circle.badge.exclamationmark",
                        description: Text(
                            String(
                                localized: "progress.screen.sign_in_required.description",
                                defaultValue: "Start a guest or linked cloud session to load progress.",
                                table: progressStringsTableName,
                                comment: "Progress sign-in-required description"
                            )
                        )
                    )
                }
            } else if self.isLoading {
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

            if progressIsUnavailable(cloudState: self.store.cloudSettings?.cloudState) == false,
               let progressPresentation = self.progressPresentation {
                Section(
                    String(
                        localized: "progress.screen.streak.section_title",
                        defaultValue: "Streak",
                        table: progressStringsTableName,
                        comment: "Progress streak section title"
                    )
                ) {
                    ProgressStreakSection(weeks: progressPresentation.streakWeeks)
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
                        chartDays: progressPresentation.chartDays,
                        chartUpperBound: progressPresentation.chartUpperBound,
                        hasReviewActivity: progressPresentation.hasReviewActivity
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
        .task(id: self.reloadTaskID) {
            await self.reloadProgressIfNeeded()
        }
        .onChange(of: self.navigation.selectedTab) { _, nextTab in
            guard nextTab == .progress else {
                return
            }

            Task { @MainActor in
                await self.reloadProgressIfNeeded()
            }
        }
        .refreshable {
            await self.reloadProgressIfNeeded()
        }
    }

    @MainActor
    private func reloadProgressIfNeeded() async {
        let requestSequence = self.beginReloadRequestSequence()

        guard progressIsUnavailable(cloudState: self.store.cloudSettings?.cloudState) == false else {
            guard self.isCurrentReloadRequest(sequence: requestSequence) else {
                return
            }

            self.progressPresentation = nil
            self.screenErrorMessage = ""
            self.isLoading = false
            return
        }

        self.isLoading = true

        do {
            let progressSeries = try await self.store.loadRecentProgress()
            let progressCalendar = makeProgressCalendar(timeZone: .current)
            let progressPresentation = try makeProgressPresentation(
                series: progressSeries,
                calendar: progressCalendar
            )

            guard self.isCurrentReloadRequest(sequence: requestSequence) else {
                return
            }

            self.progressPresentation = progressPresentation
            self.screenErrorMessage = ""
        } catch is CancellationError {
            return
        } catch {
            guard self.isCurrentReloadRequest(sequence: requestSequence) else {
                return
            }

            self.screenErrorMessage = Flashcards.errorMessage(error: error)
        }

        guard self.isCurrentReloadRequest(sequence: requestSequence) else {
            return
        }

        self.isLoading = false
    }

    @MainActor
    private func beginReloadRequestSequence() -> Int {
        self.nextReloadRequestSequence += 1
        return self.nextReloadRequestSequence
    }

    @MainActor
    private func isCurrentReloadRequest(sequence: Int) -> Bool {
        self.nextReloadRequestSequence == sequence
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

private func progressIsUnavailable(cloudState: CloudAccountState?) -> Bool {
    switch cloudState {
    case .linked, .guest:
        return false
    case .disconnected, .linkingReady, nil:
        return true
    }
}

private func makeProgressCalendar(timeZone: TimeZone) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = .autoupdatingCurrent
    calendar.timeZone = timeZone
    return calendar
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
