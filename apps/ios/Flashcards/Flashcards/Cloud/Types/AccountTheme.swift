import SwiftUI

/// Account-wide interface style. The OS appearance is never followed, so Dark is the default.
enum AccountTheme: String, Codable, CaseIterable, Identifiable, Hashable, Sendable {
    case dark
    case light

    static let defaultTheme: AccountTheme = .dark

    var id: String { self.rawValue }

    var colorScheme: ColorScheme {
        switch self {
        case .dark:
            return .dark
        case .light:
            return .light
        }
    }

    var title: String {
        switch self {
        case .dark:
            return aiSettingsLocalized("settings.theme.dark", "Dark")
        case .light:
            return aiSettingsLocalized("settings.theme.light", "Light")
        }
    }
}

extension AccountAccentColor {
    func displayed(theme: AccountTheme) -> AccountAccentColor {
        switch theme {
        case .dark:
            return self
        case .light:
            return self.adjustedForContrast(against: AccountAccentColor(rgb: 0xFFFFFF), minimumRatio: 3)
        }
    }
}

#if !os(watchOS)
/// Resolves per appearance, so it follows the theme the root view applies with `.preferredColorScheme`.
func themeAdaptiveColor(light: UIColor, dark: UIColor) -> Color {
    Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? dark : light
    })
}
#endif
