import SwiftUI
import UIKit

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
    let colorScheme: ColorScheme
    let displayScale: CGFloat
}

private struct FirstReviewOnboardingDrawing {
    let key: FirstReviewOnboardingDrawingKey
    let image: UIImage
    let bounds: CGRect
}

/// Moves and container resizes, such as a resizing window or side chat, redraw once the layout holds this long.
private let firstReviewOnboardingSettledRedrawDelay: Duration = .milliseconds(150)

struct FirstReviewOnboardingOverlay: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    let target: CGRect
    let size: CGSize
    let accent: AccountAccentColor
    let animates: Bool
    @State private var drawings: [FirstReviewOnboardingDrawing] = []
    private let drawingBleed: CGFloat = 40

    var body: some View {
        let key = FirstReviewOnboardingDrawingKey(
            target: self.target, size: self.size, accent: self.accent,
            colorScheme: self.colorScheme, displayScale: self.displayScale
        )
        let drawings = self.drawings
        return TimelineView(.animation(minimumInterval: 0.235, paused: self.animates == false)) { timeline in
            let frame = self.animates
                ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.235) % 2 : 0
            Color.clear.overlay(alignment: .topLeading) {
                if drawings.indices.contains(frame) {
                    let drawing = drawings[frame]
                    // Until the next redraw, the last drawing follows the target's center.
                    let shiftX = key.target.midX - drawing.key.target.midX
                    let shiftY = key.target.midY - drawing.key.target.midY
                    Image(uiImage: drawing.image)
                        .renderingMode(.original)
                        .resizable()
                        .frame(width: drawing.bounds.width, height: drawing.bounds.height)
                        .offset(x: drawing.bounds.minX + shiftX, y: drawing.bounds.minY + shiftY)
                }
            }
        }
        .onChange(of: key, initial: true) { previousKey, nextKey in
            if firstReviewOnboardingRedrawsImmediately(
                drawnKey: self.drawings.first?.key, previousKey: previousKey, nextKey: nextKey
            ) {
                self.draw(key: nextKey)
            }
        }
        .task(id: key) {
            guard self.drawings.first?.key != key else { return }
            do {
                try await Task.sleep(for: firstReviewOnboardingSettledRedrawDelay)
            } catch {
                return
            }
            self.draw(key: key)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func draw(key: FirstReviewOnboardingDrawingKey) {
        self.drawings = (0..<2).map {
            makeFirstReviewOnboardingImage(
                key: key, frame: $0, drawingBleed: self.drawingBleed
            )
        }
    }
}

/// A first drawing, a new style, or a target that resizes inside a still container (the guide moving from
/// Show answer to Again) redraws at once.
private func firstReviewOnboardingRedrawsImmediately(
    drawnKey: FirstReviewOnboardingDrawingKey?,
    previousKey: FirstReviewOnboardingDrawingKey,
    nextKey: FirstReviewOnboardingDrawingKey
) -> Bool {
    guard let drawnKey else { return true }
    if drawnKey.accent != nextKey.accent || drawnKey.colorScheme != nextKey.colorScheme
        || drawnKey.displayScale != nextKey.displayScale {
        return true
    }
    return previousKey.size == nextKey.size
        && (abs(previousKey.target.width - nextKey.target.width) > 1
            || abs(previousKey.target.height - nextKey.target.height) > 1)
}

@MainActor
private func makeFirstReviewOnboardingImage(
    key: FirstReviewOnboardingDrawingKey, frame: Int, drawingBleed: CGFloat
) -> FirstReviewOnboardingDrawing {
    let marks = makeFirstReviewOnboardingDrawing(target: key.target, size: key.size, frame: frame)
    let bounds = firstReviewPencilMarksBounds(marks).insetBy(dx: -drawingBleed, dy: -drawingBleed).integral
    let format = UIGraphicsImageRendererFormat.preferred()
    format.opaque = false
    format.scale = key.displayScale
    format.preferredRange = .standard
    let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { renderer in
        let context = renderer.cgContext
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        drawFirstReviewPencilBacking(
            marks: marks, context: context, color: UIColor.black.cgColor,
            opacity: 0.85, lineWidth: 6, offset: CGSize(width: 2, height: 3)
        )
        drawFirstReviewPencilBacking(
            marks: marks, context: context,
            color: (key.colorScheme == .dark ? UIColor.white : UIColor.black).cgColor,
            opacity: 0.75, lineWidth: firstReviewPencilContrastWidth, offset: .zero
        )
        let accent = UIColor(key.accent.color).cgColor
        context.setFillColor(accent)
        context.setStrokeColor(accent)
        for mark in marks {
            context.setAlpha(CGFloat(mark.opacity))
            context.addPath(mark.path.cgPath)
            if let width = mark.lineWidth {
                context.setLineWidth(width)
                context.strokePath()
            } else {
                context.fillPath()
            }
        }
    }
    return FirstReviewOnboardingDrawing(key: key, image: image, bounds: bounds)
}

private func drawFirstReviewPencilBacking(
    marks: [FirstReviewPencilMark], context: CGContext, color: CGColor,
    opacity: CGFloat, lineWidth: CGFloat, offset: CGSize
) {
    context.saveGState()
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    context.translateBy(x: offset.width, y: offset.height)
    context.setAlpha(opacity)
    context.setFillColor(color)
    context.setStrokeColor(color)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    for mark in marks {
        if mark.lineWidth == nil {
            context.addPath(mark.path.cgPath)
            context.fillPath()
        }
        context.addPath(mark.path.cgPath)
        context.setLineWidth((mark.lineWidth ?? 0) + lineWidth)
        context.strokePath()
    }
    context.endTransparencyLayer()
    context.restoreGState()
}
