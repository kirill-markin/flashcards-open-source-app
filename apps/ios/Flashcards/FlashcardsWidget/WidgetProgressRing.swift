import SwiftUI
import WidgetKit

/// A track filled clockwise from the top in the accent colour, one lap per 1 of `laps`, up to two laps; the second
/// lap starts over the first in a second shade.
struct WidgetProgressRing: View {
    @Environment(\.widgetAccent) private var accent
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.colorScheme) private var colorScheme
    let laps: Double
    let lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.25), lineWidth: self.lineWidth)
            Circle()
                .trim(from: 0, to: min(max(self.laps, 0), 1))
                .stroke(self.firstLapColor, style: StrokeStyle(lineWidth: self.lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
            if self.laps > 1 {
                Circle()
                    .trim(from: 0, to: min(self.laps - 1, 1))
                    .stroke(self.secondLapColor, style: StrokeStyle(lineWidth: self.lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .widgetAccentable(self.renderingMode == .fullColor)
            }
        }
        .padding(self.lineWidth / 2)
    }

    /// Tinted, clear and Lock Screen renderings drop hues, so there the laps stay apart by opacity.
    private var firstLapColor: Color {
        guard self.renderingMode == .fullColor else {
            return Color.primary.opacity(self.laps > 1 ? 0.5 : 1)
        }
        return self.accent.color
    }

    private var secondLapColor: Color {
        guard self.renderingMode == .fullColor else {
            return Color.primary
        }
        return self.accent.color.mix(with: self.colorScheme == .dark ? .white : .black, by: 0.35)
    }
}

/// The last 7 days' reviews inside the ring that measures them against the usual 7 days. Without a baseline the
/// number stands alone, with no ring and no track.
struct WidgetPaceRingView: View {
    let pace: ProgressPace
    let lineWidth: CGFloat
    let numberFont: Font

    var body: some View {
        ZStack {
            if let baseline = self.pace.baseline {
                WidgetProgressRing(laps: baseline.ringProgress, lineWidth: self.lineWidth)
            }
            VStack(spacing: 0) {
                Text(self.pace.lastSevenDaysReviewCount, format: .number.notation(.compactName))
                    .font(self.numberFont.weight(.bold))
                    .fontDesign(.rounded)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text("widget.heatmap.days_count \(progressPaceWindowDayCount)", tableName: widgetStringsTableName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(.horizontal, self.lineWidth + 6)
        }
    }
}
