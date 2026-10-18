import SwiftUI

enum FirstReviewOnboardingTarget: Hashable {
    case showAnswer
    case again
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
    let accent: AccountAccentColor
}

struct FirstReviewOnboardingOverlay: View {
    let target: CGRect
    let size: CGSize
    let accent: AccountAccentColor
    let animates: Bool
    @State private var drawings: [[FirstReviewPencilMark]] = []

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.235, paused: self.animates == false)) { timeline in
            let frame = self.animates
                ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.235) % 2 : 0
            Canvas { context, _ in
                guard self.drawings.indices.contains(frame) else { return }
                for mark in self.drawings[frame] {
                    if let width = mark.lineWidth {
                        context.stroke(mark.path, with: .color(self.accent.color.opacity(mark.opacity)), lineWidth: width)
                    } else {
                        context.fill(mark.path, with: .color(self.accent.color.opacity(mark.opacity)))
                    }
                }
            }
        }
        .onChange(of: FirstReviewOnboardingDrawingKey(target: self.target, size: self.size, accent: self.accent), initial: true) { _, key in
            self.drawings = (0..<2).map {
                makeFirstReviewOnboardingDrawing(target: key.target, size: key.size, frame: $0)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
