import SwiftUI

enum FirstReviewOnboardingTarget: Hashable {
    case showAnswer
    case rating(ReviewRating)
}

struct FirstReviewOnboardingAnchors: PreferenceKey {
    static let defaultValue: [FirstReviewOnboardingTarget: Anchor<CGRect>] = [:]

    static func reduce(
        value: inout [FirstReviewOnboardingTarget: Anchor<CGRect>],
        nextValue: () -> [FirstReviewOnboardingTarget: Anchor<CGRect>]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

private struct FirstReviewOnboardingDrawingKey: Equatable {
    let target: CGRect
    let size: CGSize
    let neighboringButtons: [CGRect]
    let accent: AccountAccentColor
}

struct FirstReviewOnboardingOverlay: View {
    let target: CGRect
    let size: CGSize
    let neighboringButtons: [CGRect]
    let accent: AccountAccentColor
    let animates: Bool
    @State private var drawings: [[FirstReviewPencilMark]] = []

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.235, paused: self.animates == false)) { timeline in
            let frame = self.animates
                ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.235) % 2 : 0
            Canvas { context, _ in
                guard self.drawings.indices.contains(frame) else { return }
                context.drawLayer { contrast in
                    contrast.opacity = 0.85
                    for mark in self.drawings[frame] {
                        if mark.lineWidth == nil {
                            contrast.fill(mark.path, with: .color(self.accent.contrastingForegroundColor))
                        }
                        contrast.stroke(
                            mark.path, with: .color(self.accent.contrastingForegroundColor),
                            style: StrokeStyle(
                                lineWidth: (mark.lineWidth ?? 0) + firstReviewPencilContrastWidth,
                                lineCap: .round, lineJoin: .round
                            )
                        )
                    }
                }
                for mark in self.drawings[frame] {
                    if let width = mark.lineWidth {
                        context.stroke(mark.path, with: .color(self.accent.color.opacity(mark.opacity)), lineWidth: width)
                    } else {
                        context.fill(mark.path, with: .color(self.accent.color.opacity(mark.opacity)))
                    }
                }
            }
        }
        .onChange(of: FirstReviewOnboardingDrawingKey(
            target: self.target, size: self.size, neighboringButtons: self.neighboringButtons, accent: self.accent
        ), initial: true) { _, key in
            self.drawings = (0..<2).map {
                makeFirstReviewOnboardingDrawing(
                    target: key.target, size: key.size, neighboringButtons: key.neighboringButtons, frame: $0
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
