import SwiftUI

extension ReviewReactionRenderer {
    static func drawGoodHandDrawnCheck(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.62, exitStart: 0.84)
        let drawProgress = motionMode == .reduced ? 1 : min(reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.15), 1)
        let settle = motionMode == .reduced ? 1 : 1 + sin(phase.hold * CGFloat.pi * 2) * 0.035 * (1 - phase.hold)
        drawCheckMark(
            context: context,
            center: CGPoint(x: size.width * 0.50, y: size.height * 0.43 - (settle - 1) * 90),
            width: min(size.width * 0.58, 320) * settle,
            color: reviewReactionGreenColor(),
            lineWidth: 15,
            progress: drawProgress,
            opacity: opacity
        )
    }

    static func drawGoodLightSweep(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.38, exitStart: 0.78)
        let centerX: CGFloat
        if motionMode == .reduced {
            centerX = size.width * 0.50
        } else if progress < 0.38 {
            centerX = reviewReactionInterpolate(start: -size.width * 0.18, end: size.width * 0.50, progress: reviewReactionEaseOutCubic(progress: phase.enter))
        } else if progress < 0.78 {
            centerX = size.width * 0.50 + sin(phase.hold * CGFloat.pi * 2) * 18
        } else {
            centerX = reviewReactionInterpolate(start: size.width * 0.50, end: size.width * 1.18, progress: reviewReactionEaseInCubic(progress: phase.exit))
        }
        let center = CGPoint(x: centerX, y: size.height * 0.45 + (motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 2) * 10))
        let beamLength = size.width * 0.88
        let beamWidths: [CGFloat] = [70, 38, 12]
        let colors: [Color] = [
            reviewReactionYellowColor(),
            Color.white,
            reviewReactionGreenColor()
        ]

        for index in 0..<beamWidths.count {
            var path = Path()
            path.move(to: CGPoint(x: center.x - beamLength * 0.50, y: center.y + CGFloat(index - 1) * 10))
            path.addCurve(
                to: CGPoint(x: center.x + beamLength * 0.50, y: center.y - 36 + CGFloat(index - 1) * 8),
                control1: CGPoint(x: center.x - beamLength * 0.18, y: center.y - 90),
                control2: CGPoint(x: center.x + beamLength * 0.20, y: center.y + 64)
            )
            context.stroke(
                path,
                with: .color(colors[index].opacity(opacity * Double(0.16 + CGFloat(index) * 0.18))),
                style: StrokeStyle(lineWidth: beamWidths[index], lineCap: .round, lineJoin: .round)
            )
        }
    }

    static func drawGoodPaperPlaneCheck(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.46, exitStart: 0.78)
        let targetCenter = CGPoint(x: size.width * 0.56, y: size.height * 0.38)
        let center: CGPoint
        if motionMode == .reduced {
            center = targetCenter
        } else if progress < 0.46 {
            center = cubicBezierPoint(
                start: CGPoint(x: size.width * 0.02, y: size.height * 0.66),
                control1: CGPoint(x: size.width * 0.28, y: size.height * 0.74),
                control2: CGPoint(x: size.width * 0.30, y: size.height * 0.18),
                end: targetCenter,
                progress: reviewReactionEaseInOut(progress: phase.enter)
            )
        } else if progress < 0.78 {
            center = CGPoint(
                x: targetCenter.x + sin(phase.hold * CGFloat.pi * 2) * 18,
                y: targetCenter.y + sin(phase.hold * CGFloat.pi * 4) * 8
            )
        } else {
            center = cubicBezierPoint(
                start: targetCenter,
                control1: CGPoint(x: size.width * 0.66, y: size.height * 0.18),
                control2: CGPoint(x: size.width * 0.92, y: size.height * 0.22),
                end: CGPoint(x: size.width * 1.16, y: size.height * 0.42),
                progress: reviewReactionEaseInCubic(progress: phase.exit)
            )
        }
        let scale = min(size.width, size.height) / 390 * (motionMode == .reduced ? 1 : 0.82 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.20) * 0.24 - phase.exit * 0.12)
        let rotationDegrees = motionMode == .reduced
            ? -18
            : reviewReactionInterpolate(start: -30, end: -8, progress: phase.enter) + sin(progress * CGFloat.pi * 4) * 4 - phase.exit * 12
        drawPaperPlane(
            context: context,
            center: center,
            scale: scale,
            rotationDegrees: rotationDegrees,
            opacity: opacity
        )
        drawCheckMark(
            context: context,
            center: CGPoint(x: center.x - 58 * scale, y: center.y + 48 * scale),
            width: 72 * scale,
            color: reviewReactionGreenColor(),
            lineWidth: 7 * scale,
            progress: motionMode == .reduced ? 1 : reviewReactionClampedProgress(progress: (progress - 0.22) / 0.48),
            opacity: opacity
        )
    }

    static func drawGoodCheckSealBounce(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.36, exitStart: 0.82)
        let bounce = motionMode == .reduced ? sin(progress * CGFloat.pi) : sin(phase.hold * CGFloat.pi * 3) * (1 - phase.hold)
        let scale = motionMode == .reduced
            ? 0.95 + bounce * 0.08
            : reviewReactionPopScale(progress: progress, enterEnd: 0.36, exitStart: 0.82, baseScale: 0.52, peakScale: 1.18, settledScale: 1.00)
        drawCheckSeal(
            context: context,
            center: CGPoint(x: size.width * 0.50, y: size.height * 0.43 - bounce * 16),
            radius: min(size.width, size.height) * 0.13,
            scale: scale,
            rotationDegrees: motionMode == .reduced ? -7 : -18 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.15) * 13 + bounce * 7,
            opacity: opacity
        )
    }
}
