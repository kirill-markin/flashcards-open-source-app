import Foundation

enum LiveSmokeFailure: LocalizedError {
    case stepFailed(title: String, durationSeconds: TimeInterval, underlyingMessage: String)
    case missingElement(identifier: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingText(text: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case disabledElement(identifier: String, screen: String, step: String)
    case textInputNotReady(
        identifier: String,
        timeoutSeconds: TimeInterval,
        screen: String,
        step: String,
        exists: Bool,
        hittable: Bool,
        hasKeyboardFocus: Bool,
        softwareKeyboardVisible: Bool,
        elementLabel: String,
        elementValue: String
    )
    case unexpectedElementLabel(identifier: String, expectedLabel: String, actualLabel: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case unexpectedElementValue(identifier: String, expectedValue: String, actualValue: String, timeoutSeconds: TimeInterval, screen: String, step: String)
    case missingScreen(screen: String, identifier: String, timeoutSeconds: TimeInterval, currentScreen: String, step: String)
    case missingBackButton(screen: String, step: String)
    case currentWorkspacePickerNotVisible(screen: String, step: String)
    case unexpectedAccountState(message: String, screen: String, step: String)
    case unexpectedReviewState(message: String, screen: String, step: String)
    case aiRunDidNotFinish(timeoutSeconds: TimeInterval, screen: String, step: String)
    case aiRunReportedError(message: String, screen: String, step: String)
    case unexpectedAiConversationState(message: String, screen: String, step: String)
    case appDidNotReachForeground(timeoutSeconds: TimeInterval, appState: String, step: String)

    var errorDescription: String? {
        switch self {
        case .stepFailed(let title, let durationSeconds, let underlyingMessage):
            return "iOS live smoke step failed: \(title). Duration: \(formatDuration(seconds: durationSeconds)). \(underlyingMessage)"
        case .missingElement(let identifier, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .missingText(let text, let timeoutSeconds, let screen, let step):
            return "Text '\(text)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen)"
        case .disabledElement(let identifier, let screen, let step):
            return "Element '\(identifier)' appeared but was disabled during step '\(step)' on screen: \(screen)"
        case .textInputNotReady(
            let identifier,
            let timeoutSeconds,
            let screen,
            let step,
            let exists,
            let hittable,
            let hasKeyboardFocus,
            let softwareKeyboardVisible,
            let elementLabel,
            let elementValue
        ):
            return "Text input '\(identifier)' was not ready within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). exists=\(exists) hittable=\(hittable) hasKeyboardFocus=\(hasKeyboardFocus) softwareKeyboardVisible=\(softwareKeyboardVisible) label='\(elementLabel)' value='\(elementValue)'"
        case .unexpectedElementLabel(let identifier, let expectedLabel, let actualLabel, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not reach expected label '\(expectedLabel)' within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). Actual label: '\(actualLabel)'"
        case .unexpectedElementValue(let identifier, let expectedValue, let actualValue, let timeoutSeconds, let screen, let step):
            return "Element '\(identifier)' did not reach expected value '\(expectedValue)' within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)' on screen: \(screen). Actual value: '\(actualValue)'"
        case .missingScreen(let screen, let identifier, let timeoutSeconds, let currentScreen, let step):
            return "Screen '\(screen)' with root identifier '\(identifier)' did not appear within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(currentScreen)"
        case .missingBackButton(let screen, let step):
            return "Back button did not appear during step '\(step)' on screen: \(screen)"
        case .currentWorkspacePickerNotVisible(let screen, let step):
            return "Current Workspace picker did not appear during step '\(step)'. Current screen: \(screen)"
        case .unexpectedAccountState(let message, let screen, let step):
            return "Account state was unexpected during step '\(step)'. Current screen: \(screen). \(message)"
        case .unexpectedReviewState(let message, let screen, let step):
            return "Review screen reached an unexpected state during step '\(step)'. Current screen: \(screen). \(message)"
        case .aiRunDidNotFinish(let timeoutSeconds, let screen, let step):
            return "AI run did not finish within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. Current screen: \(screen)"
        case .aiRunReportedError(let message, let screen, let step):
            return "AI run reported an assistant error during step '\(step)'. Current screen: \(screen). Message: \(message)"
        case .unexpectedAiConversationState(let message, let screen, let step):
            return "AI conversation reached an unexpected state during step '\(step)'. Current screen: \(screen). \(message)"
        case .appDidNotReachForeground(let timeoutSeconds, let appState, let step):
            return "Application did not reach runningForeground within \(formatDuration(seconds: timeoutSeconds)) during step '\(step)'. App state: \(appState)"
        }
    }
}

func makeLiveSmokeBreadcrumbLine(
    event: String,
    step: String,
    action: String,
    identifier: String,
    timeoutSeconds: String,
    durationSeconds: String,
    screen: String,
    result: String,
    note: String
) -> String {
    let payload: [String: String] = [
        "domain": "ios_ui_smoke",
        "event": event,
        "step": step,
        "action": action,
        "identifier": identifier,
        "timeoutSeconds": timeoutSeconds,
        "durationSeconds": durationSeconds,
        "screen": screen,
        "result": result,
        "note": note
    ]

    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let line = String(data: data, encoding: .utf8) else {
        return "{\"domain\":\"ios_ui_smoke\",\"event\":\"serialization_failed\"}"
    }

    return line
}

func formatDuration(seconds: TimeInterval) -> String {
    String(format: "%.2fs", seconds)
}
