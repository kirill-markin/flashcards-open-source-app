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
    let accent: AccountAccentColor
}

struct FirstReviewOnboardingOverlay: View {
    @Environment(\.colorScheme) private var colorScheme
    let target: CGRect
    let size: CGSize
    let accent: AccountAccentColor
    let animates: Bool
    @State private var drawings: [[FirstReviewPencilMark]] = []
    private let drawingBleed: CGFloat = 40

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.235, paused: self.animates == false)) { timeline in
            let frame = self.animates
                ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.235) % 2 : 0
            Canvas { context, _ in
                guard self.drawings.indices.contains(frame) else { return }
                context.translateBy(x: self.drawingBleed, y: self.drawingBleed)
                context.drawLayer { shadow in
                    shadow.translateBy(x: 2, y: 3)
                    shadow.opacity = 0.85
                    for mark in self.drawings[frame] {
                        if mark.lineWidth == nil {
                            shadow.fill(mark.path, with: .color(.black))
                        }
                        shadow.stroke(
                            mark.path, with: .color(.black),
                            style: StrokeStyle(
                                lineWidth: (mark.lineWidth ?? 0) + 6,
                                lineCap: .round, lineJoin: .round
                            )
                        )
                    }
                }
                let contrastColor: Color = self.colorScheme == .dark ? .white : .black
                context.drawLayer { contrast in
                    contrast.opacity = 0.75
                    for mark in self.drawings[frame] {
                        if mark.lineWidth == nil {
                            contrast.fill(mark.path, with: .color(contrastColor))
                        }
                        contrast.stroke(
                            mark.path, with: .color(contrastColor),
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
            .padding(-self.drawingBleed)
        }
        .onChange(of: FirstReviewOnboardingDrawingKey(
            target: self.target, size: self.size, accent: self.accent
        ), initial: true) { _, key in
            self.drawings = (0..<2).map {
                makeFirstReviewOnboardingDrawing(
                    target: key.target, size: key.size, frame: $0
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
