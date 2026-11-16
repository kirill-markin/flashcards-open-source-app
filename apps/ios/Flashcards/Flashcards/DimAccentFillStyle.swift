import SwiftUI

/// The native bordered Review chips' color over systemBackground, kept opaque so cards and materials match it too.
struct DimAccentFillStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        // FlashcardsApp sets tint and accentColor together from the user's current displayed accent.
        let accent = Color.accentColor.resolve(in: environment)
        let background = Color(uiColor: .systemBackground).resolve(in: environment)
        let alpha: Float = environment.colorScheme == .dark ? 0.25 : 0.18

        return Color(
            .sRGB,
            red: Double(accent.red * alpha + background.red * (1 - alpha)),
            green: Double(accent.green * alpha + background.green * (1 - alpha)),
            blue: Double(accent.blue * alpha + background.blue * (1 - alpha))
        )
    }
}

extension ShapeStyle where Self == DimAccentFillStyle {
    static var dimAccent: DimAccentFillStyle { DimAccentFillStyle() }
}
