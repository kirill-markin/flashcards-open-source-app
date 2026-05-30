import SwiftUI

extension ReviewReactionRenderer {
    static func drawEasyCrownBounce(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.44, exitStart: 0.82)
        let sideLength: CGFloat = max(min(size.width, size.height) * 0.64, 1)
        let targetCenter: CGPoint = CGPoint(
            x: size.width * 0.50,
            y: adjustedReviewReactionCenterY(
                configuredCenterY: reviewReactionDefaultAnchorY,
                sideLength: sideLength,
                containerHeight: size.height
            )
        )
        let bounce = motionMode == .reduced ? sin(progress * CGFloat.pi) : sin(phase.hold * CGFloat.pi * 3) * (1 - phase.hold)
        let center = CGPoint(
            x: targetCenter.x + (motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 2) * 6 * (1 - phase.exit)),
            y: motionMode == .reduced
                ? targetCenter.y
                : reviewReactionInterpolate(start: -min(size.width, size.height) * 0.16, end: targetCenter.y, progress: reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.10)) - bounce * 28 + phase.exit * 18
        )
        let scalePop = motionMode == .reduced
            ? 0.92 + bounce * 0.10
            : reviewReactionPopScale(progress: progress, enterEnd: 0.44, exitStart: 0.82, baseScale: 0.58, peakScale: 1.18, settledScale: 1.00)
        drawCrown(
            context: context,
            center: center,
            scale: min(size.width, size.height) / 360 * scalePop,
            rotationDegrees: motionMode == .reduced ? -3 : -14 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.20) * 18 + bounce * 4,
            opacity: opacity
        )
        drawSparkle(
            context: context,
            center: CGPoint(x: center.x + 76 + phase.hold * 16, y: center.y - 48 - abs(bounce) * 10),
            radius: 14 * (0.80 + sin(progress * CGFloat.pi * 5) * 0.18 + phase.enter * 0.20),
            rotation: progress * CGFloat.pi * 2,
            color: reviewReactionYellowColor(),
            opacity: opacity
        )
    }

}
