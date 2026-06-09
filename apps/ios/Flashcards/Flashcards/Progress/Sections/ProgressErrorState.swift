import Foundation

struct ProgressErrorState: Equatable, Sendable {
    let generalMessage: String
    let summaryRefreshMessage: String
    let seriesRefreshMessage: String
    let reviewScheduleRefreshMessage: String
    let reviewScheduleRenderMessage: String
}

func makeEmptyProgressErrorState() -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: ""
    )
}

func progressErrorStateWithOnlyGeneralMessage(message: String) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: message,
        summaryRefreshMessage: "",
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: ""
    )
}

func progressErrorStateClearingGeneralAndSummaryRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingGeneralAndSeriesRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingGeneralMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingSummaryRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingSeriesRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: "",
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingReviewScheduleRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: "",
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
    )
}

func progressErrorStateClearingReviewScheduleRenderMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: state.seriesRefreshMessage,
        reviewScheduleRefreshMessage: state.reviewScheduleRefreshMessage,
        reviewScheduleRenderMessage: ""
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
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
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
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
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
        reviewScheduleRenderMessage: state.reviewScheduleRenderMessage
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
        reviewScheduleRenderMessage: message
    )
}

func progressErrorDisplayMessage(state: ProgressErrorState) -> String {
    [
        state.generalMessage,
        state.summaryRefreshMessage,
        state.seriesRefreshMessage,
        state.reviewScheduleRefreshMessage,
        state.reviewScheduleRenderMessage,
    ]
        .filter { message in
            message.isEmpty == false
        }
        .joined(separator: "\n")
}
