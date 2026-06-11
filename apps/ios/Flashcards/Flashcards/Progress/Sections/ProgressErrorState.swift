import Foundation

struct ProgressErrorState: Equatable, Sendable {
    let generalMessage: String
    let summaryRefreshMessage: String
    let seriesRefreshMessage: String
    let reviewScheduleRefreshMessage: String
    let reviewScheduleRenderMessage: String
    let leaderboardRefreshMessage: String
}

func makeEmptyProgressErrorState() -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: ""
    )
}

func progressErrorStateWithOnlyGeneralMessage(message: String) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: message,
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: ""
    )
}

func progressErrorStateClearingGeneralAndSummaryRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndSeriesRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndLeaderboardRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: ""
    )
}

func progressErrorStateClearingGeneralMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingSummaryRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingSeriesRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingReviewScheduleRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingReviewScheduleRenderMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateClearingLeaderboardRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: ""
    )
}

func progressErrorStateWithSummaryRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: message,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateWithSeriesRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: message,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateWithReviewScheduleRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: message,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateWithReviewScheduleRenderMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: message,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage
    )
}

func progressErrorStateWithLeaderboardRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: message
    )
}

func progressErrorDisplayMessage(state: ProgressErrorState) -> String {
    [
        state.generalMessage,
        state.summaryRefreshMessage,
        state.seriesRefreshMessage,
        state.reviewScheduleRefreshMessage,
        state.reviewScheduleRenderMessage,
        state.leaderboardRefreshMessage,
    ]
        .filter { message in
            message.isEmpty == false
        }
        .joined(separator: "\n")
}
