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

private struct FirstReviewOnboardingDrawingKey: Equatable, Sendable {
    let target: CGRect
    let size: CGSize
    let accent: AccountAccentColor
    let colorScheme: ColorScheme
    let displayScale: CGFloat
    let animates: Bool
}

private struct FirstReviewOnboardingDrawing: Sendable {
    let image: UIImage
    let bounds: CGRect
}

struct FirstReviewOnboardingOverlay: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    let target: CGRect
    let size: CGSize
    let accent: AccountAccentColor
    let animates: Bool
    @State private var rendered: (key: FirstReviewOnboardingDrawingKey, drawings: [FirstReviewOnboardingDrawing])?

    var body: some View {
        let key = FirstReviewOnboardingDrawingKey(
            target: self.target, size: self.size, accent: self.accent,
            colorScheme: self.colorScheme, displayScale: self.displayScale, animates: self.animates
        )
        let rendered = self.rendered
        return TimelineView(.animation(minimumInterval: 0.235, paused: key.animates == false)) { timeline in
            let frame = key.animates
                ? Int(timeline.date.timeIntervalSinceReferenceDate / 0.235) % 2 : 0
            Color.clear.overlay(alignment: .topLeading) {
                if let rendered, rendered.key == key, rendered.drawings.indices.contains(frame) {
                    let drawing = rendered.drawings[frame]
                    Image(uiImage: drawing.image)
                        .renderingMode(.original)
                        .resizable()
                        .frame(width: drawing.bounds.width, height: drawing.bounds.height)
                        .offset(x: drawing.bounds.minX, y: drawing.bounds.minY)
                }
            }
        }
        .task(id: key) {
            guard let drawings = await makeFirstReviewOnboardingDrawings(key: key),
                  Task.isCancelled == false else {
                return
            }
            self.rendered = (key, drawings)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

@concurrent
private func makeFirstReviewOnboardingDrawings(
    key: FirstReviewOnboardingDrawingKey
) async -> [FirstReviewOnboardingDrawing]? {
    let frameCount = key.animates ? 2 : 1
    var drawings: [FirstReviewOnboardingDrawing] = []
    for frame in 0..<frameCount {
        guard Task.isCancelled == false,
              let drawing = makeFirstReviewOnboardingImage(key: key, frame: frame) else {
            return nil
        }
        drawings.append(drawing)
    }
    return drawings
}

private func makeFirstReviewOnboardingImage(
    key: FirstReviewOnboardingDrawingKey, frame: Int
) -> FirstReviewOnboardingDrawing? {
    let marks = makeFirstReviewOnboardingDrawing(target: key.target, size: key.size, frame: frame)
    let drawingBleed: CGFloat = 40
    let bounds = firstReviewPencilMarksBounds(marks).insetBy(dx: -drawingBleed, dy: -drawingBleed).integral
    guard Task.isCancelled == false else {
        return nil
    }
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
        guard Task.isCancelled == false else {
            return
        }
        drawFirstReviewPencilBacking(
            marks: marks, context: context,
            color: (key.colorScheme == .dark ? UIColor.white : UIColor.black).cgColor,
            opacity: 0.75, lineWidth: firstReviewPencilContrastWidth, offset: .zero
        )
        let accent = UIColor(key.accent.color).cgColor
        context.setFillColor(accent)
        context.setStrokeColor(accent)
        for mark in marks {
            guard Task.isCancelled == false else {
                return
            }
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
    guard Task.isCancelled == false else {
        return nil
    }
    return FirstReviewOnboardingDrawing(image: image, bounds: bounds)
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
        guard Task.isCancelled == false else {
            break
        }
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
