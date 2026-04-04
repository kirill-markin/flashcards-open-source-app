import Foundation

private enum UITestAppConfigurationError: LocalizedError, Equatable {
    case missingBundleIdentifier

    var errorDescription: String? {
        switch self {
        case .missingBundleIdentifier:
            return "UI test bundle configuration is missing CFBundleIdentifier"
        }
    }
}

func uiTestBundleIdentifier() -> String {
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
        preconditionFailure(
            "Flashcards UI test configuration is invalid: \(UITestAppConfigurationError.missingBundleIdentifier.localizedDescription)"
        )
    }

    let trimmedValue = bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedValue.isEmpty == false else {
        preconditionFailure(
            "Flashcards UI test configuration is invalid: \(UITestAppConfigurationError.missingBundleIdentifier.localizedDescription)"
        )
    }

    return trimmedValue
}
