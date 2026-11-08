import SwiftUI
import WidgetKit

/// A track filled clockwise from the top by `fraction`, between 0 and 1, in the accent colour.
struct WidgetProgressRing: View {
    let fraction: Double
    let lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.25), lineWidth: self.lineWidth)
            Circle()
                .trim(from: 0, to: self.fraction)
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: self.lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
        }
        .padding(self.lineWidth / 2)
    }
}
