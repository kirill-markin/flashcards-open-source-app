import Foundation

func currentAppUILocaleIdentifier() -> String? {
    currentAppUILocaleIdentifier(preferredLocalizations: Bundle.main.preferredLocalizations)
}

func currentAppUILocaleIdentifier(preferredLocalizations: [String]) -> String? {
    let localeIdentifier = preferredLocalizations.first { candidate in
        candidate.isEmpty == false && candidate != "Base"
    }

    guard let localeIdentifier else {
        return nil
    }

    return localeIdentifier.replacingOccurrences(of: "_", with: "-")
}
