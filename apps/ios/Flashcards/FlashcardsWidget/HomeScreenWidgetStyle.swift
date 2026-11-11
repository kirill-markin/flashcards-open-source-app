import SwiftUI
import WidgetKit

struct WidgetAccent {
    let color: Color
    let filledLabelColor: Color

    static let system = WidgetAccent(color: .accentColor, filledLabelColor: .white)
}

extension EnvironmentValues {
    @Entry var widgetAccent: WidgetAccent = .system
}

extension View {
    func homeScreenWidgetStyle(accentColor: AccountAccentColor?) -> some View {
        self.modifier(HomeScreenWidgetStyle(accentColor: accentColor))
    }
}

private struct HomeScreenWidgetStyle: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    let accentColor: AccountAccentColor?

    func body(content: Content) -> some View {
        content
            .environment(\.widgetAccent, self.widgetAccent)
            .containerBackground(.fill.tertiary, for: .widget)
    }

    private var widgetAccent: WidgetAccent {
        guard self.renderingMode == .fullColor else { return .system }

        // The semantic fill does not expose its resolved color; use conservative neutral references for each appearance.
        let background = AccountAccentColor(rgb: self.colorScheme == .dark ? 0x2C2C2E : 0xD1D1D6)
        let accent = (self.accentColor ?? .defaultColor).adjustedForContrast(against: background, minimumRatio: 4.5)
        return WidgetAccent(color: accent.color, filledLabelColor: accent.contrastingForegroundColor)
    }
}
