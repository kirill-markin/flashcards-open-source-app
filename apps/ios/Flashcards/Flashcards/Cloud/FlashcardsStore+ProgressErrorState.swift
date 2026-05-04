import Foundation

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

    private func applyProgressErrorState(state: ProgressErrorState) {
        self.progressErrorState = state
        let message = progressErrorDisplayMessage(state: state)
        if self.progressErrorMessage != message {
            self.progressErrorMessage = message
        }
    }
}
