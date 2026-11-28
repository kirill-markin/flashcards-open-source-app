import SwiftUI

/// The wire `theme` preference. Dark is the default; `followSystemAppearance` takes precedence over it.
enum AccountTheme: String, Codable, Hashable, Sendable {
    case dark
    case light

    static let defaultTheme: AccountTheme = .dark
}

/// The Theme picker's choice, combining the wire `theme` and `followSystemAppearance` preferences.
enum AccountThemeSelection: String, CaseIterable, Identifiable, Hashable, Sendable {
    case dark
    case light
    case automatic

    static let defaultSelection: AccountThemeSelection = .dark

    init(theme: AccountTheme, followSystemAppearance: Bool) {
        if followSystemAppearance {
            self = .automatic
            return
        }
        switch theme {
        case .dark:
            self = .dark
        case .light:
            self = .light
        }
    }

    var id: String { self.rawValue }

    /// Nil applies no override, so the system appearance shows.
    var colorScheme: ColorScheme? {
        switch self {
        case .dark:
            return .dark
        case .light:
            return .light
        case .automatic:
            return nil
        }
    }

    var title: String {
        switch self {
        case .dark:
            return aiSettingsLocalized("settings.theme.dark", "Dark")
        case .light:
            return aiSettingsLocalized("settings.theme.light", "Light")
        case .automatic:
            return aiSettingsLocalized("settings.theme.automatic", "Automatic")
        }
    }
}

extension AccountAccentColor {
    /// `colorScheme` is the resolved appearance, which under Automatic is the system's.
    func displayed(colorScheme: ColorScheme) -> AccountAccentColor {
        colorScheme == .light
            ? self.adjustedForContrast(against: AccountAccentColor(rgb: 0xFFFFFF), minimumRatio: 3)
            : self
    }
}

#if !os(watchOS)
/// Resolves per appearance, so it follows the displayed theme, including the system's under Automatic.
func themeAdaptiveColor(light: UIColor, dark: UIColor) -> Color {
    Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? dark : light
    })
}
#endif
