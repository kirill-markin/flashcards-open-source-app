import Foundation

struct ProgressErrorState: Equatable, Sendable {
    let generalMessage: String
    let summaryRefreshMessage: String
    let seriesRefreshMessage: String
}

func makeEmptyProgressErrorState() -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: ""
    )
}

func progressErrorStateWithOnlyGeneralMessage(message: String) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: message,
        summaryRefreshMessage: "",
        seriesRefreshMessage: ""
    )
}

func progressErrorStateClearingGeneralAndSummaryRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage
    )
}

func progressErrorStateClearingGeneralAndSeriesRefreshMessages(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: ""
    )
}

func progressErrorStateClearingSummaryRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: "",
        seriesRefreshMessage: state.seriesRefreshMessage
    )
}

func progressErrorStateClearingSeriesRefreshMessage(state: ProgressErrorState) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: state.generalMessage,
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: ""
    )
}

func progressErrorStateWithSummaryRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: message,
        seriesRefreshMessage: state.seriesRefreshMessage
    )
}

func progressErrorStateWithSeriesRefreshMessage(
    state: ProgressErrorState,
    message: String
) -> ProgressErrorState {
    ProgressErrorState(
        generalMessage: "",
        summaryRefreshMessage: state.summaryRefreshMessage,
        seriesRefreshMessage: message
    )
}

func progressErrorDisplayMessage(state: ProgressErrorState) -> String {
    [
        state.generalMessage,
        state.summaryRefreshMessage,
        state.seriesRefreshMessage,
    ]
        .filter { message in
            message.isEmpty == false
        }
        .joined(separator: "\n")
}
