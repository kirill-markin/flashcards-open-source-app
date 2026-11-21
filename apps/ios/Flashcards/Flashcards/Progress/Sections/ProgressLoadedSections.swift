import Foundation
import SwiftUI

// The six loaded Progress cards are siblings at one nesting level so the
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
    @Binding var leaderboardWindowSelection: ProgressLeaderboardWindowSelection?
    @Binding var reviewChartPageSelection: ProgressReviewChartPageSelection?
    let onOpenCloudSignIn: () -> Void
    let onOpenFriendInvite: () -> Void
    let onOpenProfile: (ProgressLeaderboardSelectedProfile) -> Void

    var body: some View {
        ProgressStreakCard(progressSnapshot: self.progressSnapshot)

        ProgressLeaderboardCard(
            snapshot: self.leaderboardSnapshot,
            isRefreshing: self.isProgressRefreshing,
            leaderboardRefreshMessage: self.leaderboardRefreshMessage,
            windowSelection: self.$leaderboardWindowSelection,
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

        ProgressReviewsCard(
            progressSnapshot: self.progressSnapshot,
            pageSelection: self.$reviewChartPageSelection
        )

        ProgressReviewScheduleCard(
            snapshot: self.reviewScheduleSnapshot,
            secondsPerDueCard: self.progressSnapshot.insights?.secondsPerDueCard
        )

        ProgressRecordsCard(progressSnapshot: self.progressSnapshot)
    }
}

private struct ProgressStreakCard: View {
    private let summary: ProgressSummary
    private let streakWeeks: [ProgressCalendarWeek]
    private let presentationCalendar: Calendar
    private let accessibilityValue: String

    init(progressSnapshot: ProgressSnapshot) {
        self.summary = progressSnapshot.summary
        self.streakWeeks = progressSnapshot.streakWeeks
        self.presentationCalendar = progressSnapshot.presentationCalendar
        self.accessibilityValue = progressSummaryUITestValue(snapshot: progressSnapshot)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                String(
                    localized: "progress.screen.streak.section_title",
                    defaultValue: "Streak",
                    table: "Foundation",
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
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(UITestIdentifier.progressStreakSection)
        .accessibilityValue(self.accessibilityValue)
        .modifier(ProgressCardModifier())
    }
}

private struct ProgressLeaderboardCard: View {
    let snapshot: ProgressLeaderboardSnapshot?
    let isRefreshing: Bool
    let leaderboardRefreshMessage: String
    @Binding var windowSelection: ProgressLeaderboardWindowSelection?
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
                    windowSelection: self.$windowSelection,
                    onOpenCloudSignIn: self.onOpenCloudSignIn,
                    onOpenFriendInvite: self.onOpenFriendInvite,
                    onOpenProfile: self.onOpenProfile
                )
            }
            .id(ProgressScreenSectionID.leaderboard)
            .accessibilityElement(children: .contain)
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
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(UITestIdentifier.progressStreakLeaderboardSection)
            .modifier(ProgressCardModifier())
        }
    }
}

private struct ProgressReviewsCard: View {
    private let chartDays: [ProgressChartDay]
    private let pace: ProgressPace
    private let studyMinutes: Int?
    private let selectionResetKey: String
    private let presentationCalendar: Calendar
    @Binding private var pageSelection: ProgressReviewChartPageSelection?

    init(progressSnapshot: ProgressSnapshot, pageSelection: Binding<ProgressReviewChartPageSelection?>) {
        self.chartDays = progressSnapshot.chartData.chartDays
        self.pace = makeProgressPace(dayReviewCounts: progressSnapshot.chartData.chartDays.map(\.reviewCount))
        self.studyMinutes = progressSnapshot.insights?.studySecondsByDay.flatMap { studyDays in
            makeStudyTimeMinutes(seconds: studyDays.reduce(0) { total, studyDay in total + studyDay.seconds })
        }
        self.selectionResetKey = progressSnapshot.scopeKey.storageKey
        self.presentationCalendar = progressSnapshot.presentationCalendar
        self._pageSelection = pageSelection
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProgressReviewsSection(
                chartDays: self.chartDays,
                pace: self.pace,
                studyMinutes: self.studyMinutes,
                chartCalendar: self.presentationCalendar,
                selectionResetKey: self.selectionResetKey,
                pageSelection: self.$pageSelection
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(UITestIdentifier.progressReviewsSection)
        .modifier(ProgressCardModifier())
    }
}

private struct ProgressReviewScheduleCard: View {
    let snapshot: ReviewScheduleSnapshot?
    let secondsPerDueCard: Double?

    var body: some View {
        if let snapshot = self.snapshot {
            VStack(alignment: .leading, spacing: 0) {
                ProgressReviewScheduleSection(snapshot: snapshot, secondsPerDueCard: self.secondsPerDueCard)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(UITestIdentifier.progressReviewScheduleSection)
            .modifier(ProgressCardModifier())
        }
    }
}

private struct ProgressRecordsCard: View {
    private let records: ProgressRecords?
    private let presentationCalendar: Calendar

    init(progressSnapshot: ProgressSnapshot) {
        self.records = makeProgressRecords(progressSnapshot: progressSnapshot)
        self.presentationCalendar = progressSnapshot.presentationCalendar
    }

    var body: some View {
        if let records = self.records {
            VStack(alignment: .leading, spacing: 0) {
                ProgressRecordsSection(records: records, calendar: self.presentationCalendar)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(UITestIdentifier.progressRecordsSection)
            .modifier(ProgressCardModifier())
        }
    }
}

private func progressSummaryUITestValue(snapshot: ProgressSnapshot) -> String {
    let summary = snapshot.summary
    var components: [String] = [
        "currentStreakDays=\(summary.currentStreakDays)",
        "longestStreakDays=\(summary.longestStreakDays)",
        "hasReviewedToday=\(summary.hasReviewedToday ? "true" : "false")",
        "activeReviewDays=\(summary.activeReviewDays)",
        "streakFreezeAvailableCredits=\(summary.streakFreeze.availableCredits)",
        "streakFreezeCapacity=\(summary.streakFreeze.capacity)"
    ]
    if AutomationRun.current.isUITestLaunch, snapshot.seriesSourceState == .localOnly {
        let totals = snapshot.chartData.chartDays.reduce(into: (good: 0, easy: 0)) { totals, day in
            totals.good += day.goodCount
            totals.easy += day.easyCount
        }
        components.insert(contentsOf: ["localGoodReviews=\(totals.good)", "localEasyReviews=\(totals.easy)"], at: 0)
    }
    return components.joined(separator: ";")
}
