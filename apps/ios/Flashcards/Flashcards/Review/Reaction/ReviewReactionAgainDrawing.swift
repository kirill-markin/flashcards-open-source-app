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

}
