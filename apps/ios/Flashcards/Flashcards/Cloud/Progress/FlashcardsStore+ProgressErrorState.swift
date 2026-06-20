import Foundation

func localizedProgressUnavailableErrorMessage() -> String {
    String(
        localized: "progress.error.unavailable",
        defaultValue: "Progress is unavailable. Pull to refresh and try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when progress cannot be prepared"
    )
}

func localizedProgressSummaryRefreshErrorMessage() -> String {
    String(
        localized: "progress.error.summary_refresh_failed",
        defaultValue: "Progress summary couldn't refresh. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when summary refresh fails"
    )
}

func localizedProgressSeriesRefreshErrorMessage() -> String {
    String(
        localized: "progress.error.series_refresh_failed",
        defaultValue: "Progress chart couldn't refresh. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when chart refresh fails"
    )
}

func localizedProgressReviewScheduleRefreshErrorMessage() -> String {
    String(
        localized: "progress.error.review_schedule_refresh_failed",
        defaultValue: "Review schedule couldn't refresh. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when review schedule refresh fails"
    )
}

func localizedProgressReviewScheduleRenderErrorMessage() -> String {
    String(
        localized: "progress.error.review_schedule_render_failed",
        defaultValue: "Review schedule couldn't be shown. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when review schedule rendering fails"
    )
}

func localizedProgressLeaderboardRefreshErrorMessage() -> String {
    String(
        localized: "progress.error.leaderboard_refresh_failed",
        defaultValue: "Leaderboard couldn't refresh. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when leaderboard refresh fails"
    )
}

func localizedProgressStreakLeaderboardRefreshErrorMessage() -> String {
    String(
        localized: "progress.error.streak_leaderboard_refresh_failed",
        defaultValue: "Streak leaderboard couldn't refresh. Pull to try again.",
        table: progressStringsTableName,
        comment: "Generic progress card message when streak leaderboard refresh fails"
    )
}

@MainActor
extension FlashcardsStore {
    func clearProgressErrorMessage() {
        self.applyProgressErrorState(state: makeEmptyProgressErrorState())
    }

    func replaceProgressErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithOnlyGeneralMessage(message: message)
        )
    }

    func beginProgressSummaryRefreshErrorScope() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingGeneralAndSummaryRefreshMessages(
                state: self.progressErrorState
            )
        )
    }

    func beginProgressSeriesRefreshErrorScope() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingGeneralAndSeriesRefreshMessages(
                state: self.progressErrorState
            )
        )
    }

    func beginProgressReviewScheduleRefreshErrorScope() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingGeneralMessage(
                state: self.progressErrorState
            )
        )
    }

    func beginProgressLeaderboardRefreshErrorScope() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingGeneralAndLeaderboardRefreshMessages(
                state: self.progressErrorState
            )
        )
    }

    func beginProgressStreakLeaderboardRefreshErrorScope() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingGeneralAndStreakLeaderboardRefreshMessages(
                state: self.progressErrorState
            )
        )
    }

    func clearProgressSummaryRefreshErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingSummaryRefreshMessage(
                state: self.progressErrorState
            )
        )
    }

    func clearProgressSeriesRefreshErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingSeriesRefreshMessage(
                state: self.progressErrorState
            )
        )
    }

    func clearProgressReviewScheduleRefreshErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingReviewScheduleRefreshMessage(
                state: self.progressErrorState
            )
        )
    }

    func clearProgressReviewScheduleRenderErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingReviewScheduleRenderMessage(
                state: self.progressErrorState
            )
        )
    }

    func replaceProgressSummaryRefreshErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithSummaryRefreshMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    func replaceProgressSeriesRefreshErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithSeriesRefreshMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    func replaceProgressReviewScheduleRefreshErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithReviewScheduleRefreshMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    func replaceProgressReviewScheduleRenderErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithReviewScheduleRenderMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    func clearProgressLeaderboardRefreshErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingLeaderboardRefreshMessage(
                state: self.progressErrorState
            )
        )
    }

    func clearProgressStreakLeaderboardRefreshErrorMessage() {
        self.applyProgressErrorState(
            state: progressErrorStateClearingStreakLeaderboardRefreshMessage(
                state: self.progressErrorState
            )
        )
    }

    func replaceProgressLeaderboardRefreshErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithLeaderboardRefreshMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    func replaceProgressStreakLeaderboardRefreshErrorMessage(message: String) {
        self.applyProgressErrorState(
            state: progressErrorStateWithStreakLeaderboardRefreshMessage(
                state: self.progressErrorState,
                message: message
            )
        )
    }

    private func applyProgressErrorState(state: ProgressErrorState) {
        self.progressErrorState = state
        let message = progressErrorDisplayMessage(state: state)
        if self.progressErrorMessage != message {
            self.progressErrorMessage = message
        }
    }
}
