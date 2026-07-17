import Foundation

struct ProgressErrorState: Equatable, Sendable {
    let generalMessage: String
    let summaryRefreshMessage: String
    let seriesRefreshMessage: String
    let reviewScheduleRefreshMessage: String
    let reviewScheduleRenderMessage: String
    let leaderboardRefreshMessage: String
    let streakLeaderboardRefreshMessage: String
}

func makeEmptyProgressErrorState() -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: "",
        streakLeaderboardRefreshMessage: ""
    )
}

func progressErrorStateWithOnlyGeneralMessage(message: String) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: message,
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: "",
        streakLeaderboardRefreshMessage: ""
    )
}

func progressErrorStateClearingGeneralAndSummaryRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndSeriesRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndLeaderboardRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: "",
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndStreakLeaderboardRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: ""
    )
}

func progressErrorStateClearingGeneralMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingSummaryRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingSeriesRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingReviewScheduleRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingReviewScheduleRenderMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: "",
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingLeaderboardRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: "",
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateClearingStreakLeaderboardRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: ""
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
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
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
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
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
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
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
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
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
        leaderboardRefreshMessage: message,
        streakLeaderboardRefreshMessage: state.streakLeaderboardRefreshMessage
    )
}

func progressErrorStateWithStreakLeaderboardRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage,
        leaderboardRefreshMessage: state.leaderboardRefreshMessage,
        streakLeaderboardRefreshMessage: message
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
        state.streakLeaderboardRefreshMessage,
    ]
        .filter { message in
            message.isEmpty == false
        }
        .joined(separator: "\n")
}
