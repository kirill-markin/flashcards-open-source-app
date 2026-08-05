import Foundation
import SwiftUI

// The five loaded Progress cards are siblings at one nesting level so the
// enclosing lazy container keeps a shallow generic type. Each optional card
// decides on its own whether it draws, and every value a card needs is passed
// in explicitly instead of read back from the environment.
struct ProgressLoadedSections: View {
    let progressSnapshot: ProgressSnapshot
    let leaderboardSnapshot: ProgressLeaderboardSnapshot?
    let streakLeaderboardSnapshot: ProgressStreakLeaderboardSnapshot?
    let reviewScheduleSnapshot: ReviewScheduleSnapshot?
    let isProgressRefreshing: Bool
    let leaderboardRefreshMessage: String
    let streakLeaderboardRefreshMessage: String
    @Binding var selectedLeaderboardWindowKey: LeaderboardWindowKey?
    let onOpenCloudSignIn: () -> Void
    let onOpenFriendInvite: () -> Void
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    var body: some View {
        ProgressStreakCard(progressSnapshot: self.progressSnapshot)

        ProgressLeaderboardCard(
            snapshot: self.leaderboardSnapshot,
            isRefreshing: self.isProgressRefreshing,
            leaderboardRefreshMessage: self.leaderboardRefreshMessage,
            selectedWindowKey: self.$selectedLeaderboardWindowKey,
            onOpenCloudSignIn: self.onOpenCloudSignIn,
            onOpenFriendInvite: self.onOpenFriendInvite,
            onOpenProfile: self.onOpenProfile
        )

        ProgressStreakLeaderboardCard(
            snapshot: self.streakLeaderboardSnapshot,
            isRefreshing: self.isProgressRefreshing,
            streakLeaderboardRefreshMessage: self.streakLeaderboardRefreshMessage,
            onOpenProfile: self.onOpenProfile
        )

        ProgressReviewsCard(progressSnapshot: self.progressSnapshot)

        ProgressReviewScheduleCard(snapshot: self.reviewScheduleSnapshot)
    }
}

private struct ProgressStreakCard: View {
    private let summary: ProgressSummary
    private let streakWeeks: [ProgressCalendarWeek]
    private let presentationCalendar: Calendar

    init(progressSnapshot: ProgressSnapshot) {
        let presentationCalendar = requiredProgressPresentationCalendar(
            timeZoneIdentifier: progressSnapshot.scopeKey.timeZone
        )
        self.summary = progressSnapshot.summary
        self.streakWeeks = requiredProgressStreakWeeks(
            progressSnapshot: progressSnapshot,
            calendar: presentationCalendar
        )
        self.presentationCalendar = presentationCalendar
    }

    var body: some View {
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
                weeks: self.streakWeeks,
                badgeState: makeReviewProgressBadgeState(summary: self.summary),
                streakFreeze: self.summary.streakFreeze,
                calendar: self.presentationCalendar
            )
        }
        .id(ProgressScreenSectionID.streak)
        .accessibilityIdentifier(UITestIdentifier.progressStreakSection)
        .accessibilityValue(progressSummaryUITestValue(summary: self.summary))
        .modifier(ProgressCardModifier())
    }
}

private struct ProgressLeaderboardCard: View {
    let snapshot: ProgressLeaderboardSnapshot?
    let isRefreshing: Bool
    let leaderboardRefreshMessage: String
    @Binding var selectedWindowKey: LeaderboardWindowKey?
    let onOpenCloudSignIn: () -> Void
    let onOpenFriendInvite: () -> Void
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    var body: some View {
        if let snapshot = self.snapshot {
            VStack(alignment: .leading, spacing: 0) {
                ProgressLeaderboardSection(
                    snapshot: snapshot,
                    isRefreshing: self.isRefreshing,
                    leaderboardRefreshMessage: self.leaderboardRefreshMessage,
                    selectedWindowKey: self.$selectedWindowKey,
                    onOpenCloudSignIn: self.onOpenCloudSignIn,
                    onOpenFriendInvite: self.onOpenFriendInvite,
                    onOpenProfile: self.onOpenProfile
                )
            }
            .id(ProgressScreenSectionID.leaderboard)
            .accessibilityIdentifier(UITestIdentifier.progressLeaderboardSection)
            .modifier(ProgressCardModifier())
        }
    }
}

private struct ProgressStreakLeaderboardCard: View {
    let snapshot: ProgressStreakLeaderboardSnapshot?
    let isRefreshing: Bool
    let streakLeaderboardRefreshMessage: String
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    var body: some View {
        if let snapshot = self.snapshot {
            VStack(alignment: .leading, spacing: 0) {
                ProgressStreakLeaderboardSection(
                    snapshot: snapshot,
                    isRefreshing: self.isRefreshing,
                    streakLeaderboardRefreshMessage: self.streakLeaderboardRefreshMessage,
                    onOpenProfile: self.onOpenProfile
                )
            }
            .id(ProgressScreenSectionID.streakLeaderboard)
            .accessibilityIdentifier(UITestIdentifier.progressStreakLeaderboardSection)
            .modifier(ProgressCardModifier())
        }
    }
}

private struct ProgressReviewsCard: View {
    private let chartDays: [ProgressChartDay]
    private let selectionResetKey: String
    private let presentationCalendar: Calendar

    init(progressSnapshot: ProgressSnapshot) {
        self.chartDays = progressSnapshot.chartData.chartDays
        self.selectionResetKey = progressSnapshot.scopeKey.storageKey
        self.presentationCalendar = requiredProgressPresentationCalendar(
            timeZoneIdentifier: progressSnapshot.scopeKey.timeZone
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressReviewsSection(
                chartDays: self.chartDays,
                chartCalendar: self.presentationCalendar,
                selectionResetKey: self.selectionResetKey
            )
        }
        .accessibilityIdentifier(UITestIdentifier.progressReviewsSection)
        .modifier(ProgressCardModifier())
    }
}

private struct ProgressReviewScheduleCard: View {
    let snapshot: ReviewScheduleSnapshot?

    var body: some View {
        if let snapshot = self.snapshot {
            VStack(alignment: .leading, spacing: 0) {
                ProgressReviewScheduleSection(snapshot: snapshot)
            }
            .accessibilityIdentifier(UITestIdentifier.progressReviewScheduleSection)
            .modifier(ProgressCardModifier())
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
