import Foundation
import SwiftUI

private enum ProgressScreenSectionID: Hashable {
    case streak
    case leaderboard
}

private struct ProgressPresentationTaskID: Hashable {
    let requestID: UUID?
    let hasStreakSection: Bool
    let hasLeaderboardSection: Bool
}

struct ProgressScreen: View {
    @Environment(FlashcardsStore.self) private var store: FlashcardsStore
    @Environment(AppNavigationModel.self) private var navigation: AppNavigationModel
    @State private var selectedLeaderboardWindowKey: LeaderboardWindowKey?

    private var isLeaderboardSectionAvailable: Bool {
        self.store.progressSnapshot != nil && self.store.progressLeaderboardSnapshot != nil
    }

    private var isStreakSectionAvailable: Bool {
        self.store.progressSnapshot != nil
    }

    private var progressPresentationTaskID: ProgressPresentationTaskID {
        ProgressPresentationTaskID(
            requestID: self.navigation.progressPresentationRequest?.id,
            hasStreakSection: self.isStreakSectionAvailable,
            hasLeaderboardSection: self.isLeaderboardSectionAvailable
        )
    }

    var body: some View {
        ScrollViewReader { proxy in
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
                        .id(ProgressScreenSectionID.streak)
                        .accessibilityIdentifier(UITestIdentifier.progressStreakSection)
                        .accessibilityValue(progressSummaryUITestValue(summary: progressSnapshot.summary))
                        .modifier(ProgressCardModifier())

                        if let leaderboardSnapshot = self.store.progressLeaderboardSnapshot {
                            VStack(alignment: .leading, spacing: 0) {
                                ProgressLeaderboardSection(
                                    snapshot: leaderboardSnapshot,
                                    isRefreshing: self.store.isProgressRefreshing,
                                    selectedWindowKey: self.$selectedLeaderboardWindowKey
                                )
                            }
                            .id(ProgressScreenSectionID.leaderboard)
                            .accessibilityIdentifier(UITestIdentifier.progressLeaderboardSection)
                            .modifier(ProgressCardModifier())
                        }

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
            .task(id: self.progressPresentationTaskID) {
                await self.handleProgressPresentationRequest(proxy: proxy)
            }
        }
    }

    @MainActor
    private func handleProgressPresentationRequest(proxy: ScrollViewProxy) async {
        guard let request = self.navigation.progressPresentationRequest else {
            return
        }
        if request.target == .leaderboard {
            self.selectedLeaderboardWindowKey = nil
        }

        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }
        await Task.yield()
        guard self.navigation.progressPresentationRequest?.id == request.id else {
            return
        }
        guard self.isProgressPresentationTargetAvailable(target: request.target) else {
            return
        }

        withAnimation {
            proxy.scrollTo(self.progressScreenSectionID(target: request.target), anchor: .top)
        }
        self.navigation.clearProgressPresentationRequest(id: request.id)
    }

    private func isProgressPresentationTargetAvailable(target: ProgressPresentationTarget) -> Bool {
        switch target {
        case .streak:
            return self.isStreakSectionAvailable
        case .leaderboard:
            return self.isLeaderboardSectionAvailable
        }
    }

    private func progressScreenSectionID(target: ProgressPresentationTarget) -> ProgressScreenSectionID {
        switch target {
        case .streak:
            return .streak
        case .leaderboard:
            return .leaderboard
        }
    }
}

private func progressSummaryUITestValue(summary: ProgressSummary) -> String {
    let components: [String] = [
        "currentStreakDays=\(summary.currentStreakDays)",
        "longestStreakDays=\(summary.longestStreakDays)",
        "hasReviewedToday=\(summary.hasReviewedToday ? "true" : "false")",
        "activeReviewDays=\(summary.activeReviewDays)",
        "streakFreezeAvailableCredits=\(summary.streakFreeze.availableCredits)",
        "streakFreezeCapacity=\(summary.streakFreeze.capacity)"
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

#Preview {
    NavigationStack {
        ProgressScreen()
            .environment(FlashcardsStore())
            .environment(AppNavigationModel())
    }
}
