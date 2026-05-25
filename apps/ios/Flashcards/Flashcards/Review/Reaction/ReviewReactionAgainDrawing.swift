import SwiftUI

extension ReviewReactionRenderer {
    static func drawAgainRewindVortex(
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
        let center = CGPoint(
            x: size.width * 0.50 + (motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 2) * 10 * (1 - phase.exit)),
            y: size.height * 0.45 + (motionMode == .reduced ? 0 : cos(progress * CGFloat.pi * 2) * 6 * (1 - phase.exit))
        )
        let radiusPulse = motionMode == .reduced
            ? 1
            : 0.76 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.55) * 0.24 + sin(progress * CGFloat.pi * 4) * 0.04
        let maxRadius = min(size.width, size.height) * (motionMode == .reduced ? 0.20 : 0.31) * radiusPulse
        let drawProgress = motionMode == .reduced ? 1 : reviewReactionClampedProgress(progress: phase.enter + phase.hold * 0.20)
        let rotation = motionMode == .reduced ? 0 : reviewReactionEaseOutCubic(progress: progress) * CGFloat.pi * 2.35
        let colors: [Color] = [
            reviewReactionRedColor(),
            reviewReactionOrangeColor(),
            reviewReactionPinkColor()
        ]

        for index in 0..<3 {
            let startAngle = CGFloat(index) * CGFloat.pi * 2 / 3 + rotation
            let path = makeSpiralPath(
                center: center,
                maxRadius: maxRadius,
                startAngle: startAngle,
                turns: 2.15,
                progress: drawProgress
            )
            context.stroke(
                path,
                with: .color(colors[index].opacity(opacity)),
                style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round)
            )

            let arrowAngle = startAngle + drawProgress * CGFloat.pi * 2 * 2.15
            let arrowCenter = pointOnCircle(
                center: center,
                radius: maxRadius * drawProgress,
                angle: arrowAngle
            )
            drawTriangle(
                context: context,
                center: arrowCenter,
                angle: arrowAngle + CGFloat.pi * 0.52,
                radius: 15,
                color: colors[index],
                opacity: opacity
            )
        }
    }

    static func drawAgainStampFlyby(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.38, exitStart: 0.76)
        let targetCenter = CGPoint(x: size.width * 0.50, y: size.height * 0.42)
        let center: CGPoint
        if motionMode == .reduced {
            center = targetCenter
        } else if progress < 0.38 {
            center = cubicBezierPoint(
                start: CGPoint(x: size.width * -0.24, y: size.height * 0.62),
                control1: CGPoint(x: size.width * 0.08, y: size.height * 0.18),
                control2: CGPoint(x: size.width * 0.34, y: size.height * 0.24),
                end: targetCenter,
                progress: reviewReactionEaseOutCubic(progress: phase.enter)
            )
        } else if progress < 0.76 {
            let settle = sin(phase.hold * CGFloat.pi * 3) * (1 - phase.hold)
            center = CGPoint(
                x: targetCenter.x + settle * 14,
                y: targetCenter.y - abs(settle) * 10
            )
        } else {
            center = cubicBezierPoint(
                start: targetCenter,
                control1: CGPoint(x: size.width * 0.58, y: size.height * 0.34),
                control2: CGPoint(x: size.width * 0.92, y: size.height * 0.16),
                end: CGPoint(x: size.width * 1.18, y: size.height * 0.32),
                progress: reviewReactionEaseInCubic(progress: phase.exit)
            )
        }
        let radius = min(size.width, size.height) * 0.12
        let scale = motionMode == .reduced
            ? 0.95 + sin(progress * CGFloat.pi) * 0.08
            : reviewReactionPopScale(progress: progress, enterEnd: 0.38, exitStart: 0.76, baseScale: 0.68, peakScale: 1.20, settledScale: 1.00)
        let rotationDegrees = motionMode == .reduced
            ? -8
            : reviewReactionInterpolate(start: -28, end: 8, progress: reviewReactionEaseOutCubic(progress: phase.enter)) - phase.exit * 26
        let stampContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: scale
        )

        let sealPath = makeScallopedSealPath(radius: radius, teeth: 32, inset: 0.08)
        stampContext.fill(sealPath, with: .color(reviewReactionRedColor().opacity(opacity * 0.92)))
        stampContext.stroke(
            sealPath,
            with: .color(Color.white.opacity(opacity * 0.92)),
            style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
        )
        stampContext.stroke(
            makeRewindArrowPath(radius: radius * 0.50),
            with: .color(Color.white.opacity(opacity)),
            style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round)
        )
        drawTriangle(
            context: stampContext,
            center: CGPoint(x: -radius * 0.44, y: -radius * 0.16),
            angle: CGFloat.pi * 1.04,
            radius: radius * 0.18,
            color: .white,
            opacity: opacity
        )
    }

    static func drawAgainWarningTape(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.34, exitStart: 0.80)
        let snap = motionMode == .reduced ? 1 : reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.35)
        let drift = motionMode == .reduced ? 0 : sin(phase.hold * CGFloat.pi * 2) * 18 * (1 - phase.exit)
        let exitShift = motionMode == .reduced ? 0 : phase.exit * 48
        let lengthScale = motionMode == .reduced ? 1 : reviewReactionInterpolate(start: 0.18, end: 1, progress: min(snap, 1))
        drawWarningTapeBand(
            context: context,
            center: CGPoint(x: size.width * 0.50 + drift + exitShift, y: size.height * 0.32 - (1 - min(snap, 1)) * 22),
            length: size.width * 1.30 * lengthScale,
            height: 34,
            rotationDegrees: -13 - (1 - min(snap, 1)) * 10,
            opacity: opacity
        )
        drawWarningTapeBand(
            context: context,
            center: CGPoint(x: size.width * 0.50 - drift - exitShift, y: size.height * 0.58 + (1 - min(snap, 1)) * 18),
            length: size.width * 1.24 * lengthScale,
            height: 28,
            rotationDegrees: 12 + (1 - min(snap, 1)) * 8,
            opacity: opacity * 0.82
        )
    }
}
