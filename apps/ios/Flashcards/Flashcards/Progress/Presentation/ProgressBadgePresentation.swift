import SwiftUI

let reviewProgressBadgeOverflowThreshold: Int = 99

struct ReviewProgressBadgeState: Hashable, Sendable {
    let streakDays: Int
    let hasReviewedToday: Bool
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

func makeReviewProgressBadgeState(progressSnapshot: ProgressSnapshot?) -> ReviewProgressBadgeState {
    guard let progressSnapshot else {
        return makeEmptyReviewProgressBadgeState()
    }

    return ReviewProgressBadgeState(
        streakDays: progressSnapshot.summary.currentStreakDays,
        hasReviewedToday: progressSnapshot.summary.hasReviewedToday,
        isInteractive: true
    )
}

func makeReviewProgressBadgeState(summary: ProgressSummary) -> ReviewProgressBadgeState {
    ReviewProgressBadgeState(
        streakDays: summary.currentStreakDays,
        hasReviewedToday: summary.hasReviewedToday,
        isInteractive: true
    )
}
