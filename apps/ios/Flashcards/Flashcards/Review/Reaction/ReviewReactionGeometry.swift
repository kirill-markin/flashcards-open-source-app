import SwiftUI

let reviewReactionDefaultAnchorY: CGFloat = 0.50
let reviewReactionTargetAnchorY: CGFloat = 0.80
let reviewReactionVerticalShift: CGFloat = reviewReactionTargetAnchorY - reviewReactionDefaultAnchorY

func adjustedReviewReactionCenterY(
    configuredCenterY: CGFloat,
    sideLength: CGFloat,
    containerHeight: CGFloat
) -> CGFloat {
    let shiftedCenterY: CGFloat = (configuredCenterY + reviewReactionVerticalShift) * containerHeight
    let halfSideLength: CGFloat = max(sideLength, 0) / 2

    guard containerHeight > 0 else {
        return 0
    }
    guard sideLength < containerHeight else {
        return containerHeight / 2
    }

    return min(max(shiftedCenterY, halfSideLength), containerHeight - halfSideLength)
}

extension ReviewReactionRenderer {
    static func makeScallopedSealPath(
        radius: CGFloat,
        teeth: Int,
        inset: CGFloat
    ) -> Path {
        var path = Path()
        let pointCount = max(teeth * 2, 8)
        for index in 0..<pointCount {
            let isOuterPoint = index.isMultiple(of: 2)
            let pointRadius = isOuterPoint ? radius : radius * (1 - inset)
            let angle = CGFloat(index) * CGFloat.pi * 2 / CGFloat(pointCount)
            let point = pointOnCircle(center: .zero, radius: pointRadius, angle: angle)
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        path.closeSubpath()
        return path
    }

    static func makeRewindArrowPath(radius: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: radius * 0.55, y: -radius * 0.56))
        path.addCurve(
            to: CGPoint(x: -radius * 0.42, y: radius * 0.34),
            control1: CGPoint(x: -radius * 0.28, y: -radius * 0.82),
            control2: CGPoint(x: -radius * 0.78, y: -radius * 0.12)
        )
        path.addCurve(
            to: CGPoint(x: radius * 0.48, y: radius * 0.42),
            control1: CGPoint(x: -radius * 0.12, y: radius * 0.68),
            control2: CGPoint(x: radius * 0.32, y: radius * 0.64)
        )
        return path
    }

    static func transformedContext(
        context: GraphicsContext,
        center: CGPoint,
        rotationDegrees: CGFloat,
        scale: CGFloat
    ) -> GraphicsContext {
        var transformedContext = context
        transformedContext.translateBy(x: center.x, y: center.y)
        transformedContext.rotate(by: .degrees(Double(rotationDegrees)))
        transformedContext.scaleBy(x: scale, y: scale)
        return transformedContext
    }

    static func pointOnCircle(
        center: CGPoint,
        radius: CGFloat,
        angle: CGFloat
    ) -> CGPoint {
        CGPoint(
            x: center.x + cos(angle) * radius,
            y: center.y + sin(angle) * radius
        )
    }

    static func cubicBezierPoint(
        start: CGPoint,
        control1: CGPoint,
        control2: CGPoint,
        end: CGPoint,
        progress: CGFloat
    ) -> CGPoint {
        let boundedProgress = reviewReactionClampedProgress(progress: progress)
        let inverse = 1 - boundedProgress
        let startWeight = inverse * inverse * inverse
        let control1Weight = 3 * inverse * inverse * boundedProgress
        let control2Weight = 3 * inverse * boundedProgress * boundedProgress
        let endWeight = boundedProgress * boundedProgress * boundedProgress
        return CGPoint(
            x: start.x * startWeight + control1.x * control1Weight + control2.x * control2Weight + end.x * endWeight,
            y: start.y * startWeight + control1.y * control1Weight + control2.y * control2Weight + end.y * endWeight
        )
    }
}
