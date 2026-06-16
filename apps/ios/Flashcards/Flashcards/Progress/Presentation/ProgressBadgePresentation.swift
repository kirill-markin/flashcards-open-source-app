import SwiftUI
import UIKit

let reviewProgressBadgeOverflowThreshold: Int = 99

struct ReviewProgressBadgeState: Hashable, Sendable {
    let streakDays: Int
    let hasReviewedToday: Bool
    let streakFreezeAvailableCredits: Int
    let streakFreezeCapacity: Int
    let showsStreakFreezeBank: Bool
    let isInteractive: Bool
}

struct ReviewLeaderboardBadgeState: Hashable, Sendable {
    let rank: Int?
    let windowKey: LeaderboardWindowKey?
    let isInteractive: Bool
}

struct ReviewProgressBadgePresentation {
    let iconSystemName: String
    let borderColor: Color
    let iconColor: Color
    let textColor: Color
}

func makeEmptyReviewProgressBadgeState() -> ReviewProgressBadgeState {
    ReviewProgressBadgeState(
        streakDays: 0,
        hasReviewedToday: false,
        streakFreezeAvailableCredits: 0,
        streakFreezeCapacity: 0,
        showsStreakFreezeBank: false,
        isInteractive: true
    )
}

func makeEmptyReviewLeaderboardBadgeState() -> ReviewLeaderboardBadgeState {
    ReviewLeaderboardBadgeState(
        rank: nil,
        windowKey: nil,
        isInteractive: true
    )
}

func makeReviewProgressBadgePresentation(badgeState: ReviewProgressBadgeState) -> ReviewProgressBadgePresentation {
    ReviewProgressBadgePresentation(
        iconSystemName: badgeState.hasReviewedToday ? "flame.fill" : "flame",
        borderColor: badgeState.hasReviewedToday ? .accentColor.opacity(0.55) : .gray.opacity(0.35),
        iconColor: badgeState.hasReviewedToday ? .accentColor : .gray,
        textColor: badgeState.hasReviewedToday ? .primary : .secondary
    )
}

func formatReviewProgressBadgeValue(badgeState: ReviewProgressBadgeState) -> String {
    if badgeState.streakDays > reviewProgressBadgeOverflowThreshold {
        return "\(reviewProgressBadgeOverflowThreshold)+"
    }

    return badgeState.streakDays.formatted()
}

func reviewProgressFreezeBankSystemImageName() -> String {
    if UIImage(systemName: "ice.cube") != nil {
        return "ice.cube"
    }

    return "snowflake"
}

func formatReviewProgressFreezeBankValue(badgeState: ReviewProgressBadgeState) -> String {
    "\(badgeState.streakFreezeAvailableCredits)/\(badgeState.streakFreezeCapacity)"
}

func makeReviewProgressBadgeState(progressSnapshot: ProgressSnapshot?) -> ReviewProgressBadgeState {
    guard let progressSnapshot else {
        return makeEmptyReviewProgressBadgeState()
    }

    return ReviewProgressBadgeState(
        streakDays: progressSnapshot.summary.currentStreakDays,
        hasReviewedToday: progressSnapshot.summary.hasReviewedToday,
        streakFreezeAvailableCredits: progressSnapshot.summary.streakFreeze.availableCredits,
        streakFreezeCapacity: progressSnapshot.summary.streakFreeze.capacity,
        showsStreakFreezeBank: true,
        isInteractive: true
    )
}

func makeReviewProgressBadgeState(summary: ProgressSummary) -> ReviewProgressBadgeState {
    ReviewProgressBadgeState(
        streakDays: summary.currentStreakDays,
        hasReviewedToday: summary.hasReviewedToday,
        streakFreezeAvailableCredits: summary.streakFreeze.availableCredits,
        streakFreezeCapacity: summary.streakFreeze.capacity,
        showsStreakFreezeBank: true,
        isInteractive: true
    )
}

func makeReviewLeaderboardBadgeState(progressLeaderboardSnapshot: ProgressLeaderboardSnapshot?) -> ReviewLeaderboardBadgeState {
    guard let bestPlacement = resolveBestLeaderboardPlacement(snapshot: progressLeaderboardSnapshot) else {
        return makeEmptyReviewLeaderboardBadgeState()
    }

    return ReviewLeaderboardBadgeState(
        rank: bestPlacement.rank,
        windowKey: bestPlacement.windowKey,
        isInteractive: true
    )
}
