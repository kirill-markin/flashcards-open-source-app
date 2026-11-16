import SwiftUI

/// The native bordered Review chips' color over systemBackground, kept opaque so cards and materials match it too.
struct DimAccentFillStyle: ShapeStyle {
    func resolve(in environment: EnvironmentValues) -> Color {
        // Lists adapt the legacy accent lookup under Increase Contrast; keep the app's displayed tint.
        let accent = (environment.appAccentColor ?? .accentColor).resolve(in: environment)
        let background = Color(uiColor: .systemBackground).resolve(in: environment)
        // Native bordered chips keep these fill alphas with Increase Contrast too.
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

extension EnvironmentValues {
    @Entry var appAccentColor: Color? = nil
}

extension View {
    func appAccent(_ color: Color) -> some View {
        self.tint(color)
            .accentColor(color)
            .environment(\.appAccentColor, color)
    }
}
