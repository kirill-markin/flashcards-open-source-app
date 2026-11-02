import Observation
import SwiftUI

/// The window holds only for the leaderboard scope it was chosen in; a new scope falls back to the best placement.
struct ProgressLeaderboardWindowSelection: Equatable {
    let windowKey: LeaderboardWindowKey
    let scopeKey: ProgressLeaderboardScopeKey
}

/// The chart page holds only for the chart data it was chosen on; any change resets it to the latest page.
struct ProgressReviewChartPageSelection: Equatable {
    let startLocalDate: String
    let resetToken: ProgressReviewChartSelectionResetToken
}

/// App-owned so a recreated Progress screen keeps its selections and scroll offset.
@MainActor
@Observable
final class ProgressScreenState {
    var leaderboardWindowSelection: ProgressLeaderboardWindowSelection?
    var reviewChartPageSelection: ProgressReviewChartPageSelection?
    var scrollPosition: ScrollPosition

    init() {
        self.leaderboardWindowSelection = nil
        self.reviewChartPageSelection = nil
        self.scrollPosition = ScrollPosition(edge: .top)
    }
}
