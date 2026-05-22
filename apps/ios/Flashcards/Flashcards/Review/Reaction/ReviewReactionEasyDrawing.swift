import SwiftUI

extension ReviewReactionRenderer {
    static func drawEasySparkleBurst(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.56, exitStart: 0.84)
        let center = CGPoint(
            x: size.width * 0.50,
            y: size.height * 0.40 + (motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 2) * 8 * (1 - phase.exit))
        )
        let burstProgress = motionMode == .reduced ? 0.65 : reviewReactionEaseOutCubic(progress: phase.enter)
        let colors: [Color] = [
            reviewReactionYellowColor(),
            reviewReactionPinkColor(),
            reviewReactionBlueColor(),
            reviewReactionGreenColor()
        ]
        for index in 0..<18 {
            let angle = CGFloat(index) * CGFloat.pi * 2 / 18
            let localProgress = motionMode == .reduced
                ? 0.70
                : reviewReactionClampedProgress(progress: (phase.enter - CGFloat(index % 6) * 0.055) / 0.76)
            let twinkle = 0.76 + sin((progress + CGFloat(index) * 0.07) * CGFloat.pi * 5) * 0.24
            let distance = min(size.width, size.height) * (0.08 + 0.24 * max(burstProgress, localProgress))
            let point = pointOnCircle(center: center, radius: distance, angle: angle)
            if index.isMultiple(of: 3) {
                drawSparkle(
                    context: context,
                    center: point,
                    radius: (12 + CGFloat(index % 4) * 2) * twinkle,
                    rotation: angle + progress * CGFloat.pi,
                    color: colors[index % colors.count],
                    opacity: opacity * Double(localProgress)
                )
            } else {
                let dotRadius = (3 + CGFloat(index % 3)) * twinkle
                context.fill(
                    Path(ellipseIn: CGRect(x: point.x - dotRadius, y: point.y - dotRadius, width: dotRadius * 2, height: dotRadius * 2)),
                    with: .color(colors[index % colors.count].opacity(opacity * Double(localProgress)))
                )
            }
        }
    }

    static func drawEasyRainbowStreak(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.40, exitStart: 0.78)
        let centerX: CGFloat
        if motionMode == .reduced {
            centerX = size.width * 0.50
        } else if progress < 0.40 {
            centerX = reviewReactionInterpolate(start: -size.width * 0.24, end: size.width * 0.50, progress: reviewReactionEaseOutCubic(progress: phase.enter))
        } else if progress < 0.78 {
            centerX = size.width * 0.50 + sin(phase.hold * CGFloat.pi * 2) * 22
        } else {
            centerX = reviewReactionInterpolate(start: size.width * 0.50, end: size.width * 1.24, progress: reviewReactionEaseInCubic(progress: phase.exit))
        }
        let center = CGPoint(x: centerX, y: size.height * 0.44)
        let colors: [Color] = [
            reviewReactionRedColor(),
            reviewReactionOrangeColor(),
            reviewReactionYellowColor(),
            reviewReactionGreenColor(),
            reviewReactionBlueColor(),
            reviewReactionPurpleColor()
        ]

        for index in 0..<colors.count {
            let offset = CGFloat(index - 2) * 11
            var path = Path()
            path.move(to: CGPoint(x: center.x - size.width * 0.48, y: center.y + offset + 10))
            path.addCurve(
                to: CGPoint(x: center.x + size.width * 0.48, y: center.y + offset - 14),
                control1: CGPoint(x: center.x - size.width * 0.22, y: center.y + offset - 54 - sin(progress * CGFloat.pi * 2) * 12),
                control2: CGPoint(x: center.x + size.width * 0.20, y: center.y + offset + 46 + sin(progress * CGFloat.pi * 2 + CGFloat(index)) * 12)
            )
            context.stroke(
                path,
                with: .color(colors[index].opacity(opacity * 0.78)),
                style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round)
            )
        }
    }

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
        let targetCenter = CGPoint(x: size.width * 0.50, y: size.height * 0.40)
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
