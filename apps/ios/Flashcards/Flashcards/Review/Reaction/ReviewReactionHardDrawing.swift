import SwiftUI

extension ReviewReactionRenderer {
    static func drawHardHourglassSand(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.34, exitStart: 0.84)
        let center = CGPoint(x: size.width * 0.50, y: size.height * 0.42)
        let height = min(size.height * 0.34, 210)
        let width = height * 0.50
        let wobbleDegrees = motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 3.4) * 6 * (1 - phase.exit)
        let breatheScale = motionMode == .reduced ? 1 : 0.94 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.20) * 0.06 + sin(progress * CGFloat.pi * 4) * 0.018
        let hourglassContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: wobbleDegrees,
            scale: breatheScale
        )
        let sandProgress = motionMode == .reduced ? 0.60 : reviewReactionEaseInOut(progress: min(progress * 1.2, 1))
        var glass = Path()
        glass.move(to: CGPoint(x: -width * 0.48, y: -height * 0.50))
        glass.addLine(to: CGPoint(x: width * 0.48, y: -height * 0.50))
        glass.addLine(to: .zero)
        glass.addLine(to: CGPoint(x: width * 0.48, y: height * 0.50))
        glass.addLine(to: CGPoint(x: -width * 0.48, y: height * 0.50))
        glass.addLine(to: .zero)
        glass.closeSubpath()

        hourglassContext.stroke(
            glass,
            with: .color(reviewReactionYellowColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
        )

        var topSand = Path()
        topSand.move(to: CGPoint(x: -width * (0.38 - sandProgress * 0.20), y: -height * 0.40 + sandProgress * height * 0.18))
        topSand.addLine(to: CGPoint(x: width * (0.38 - sandProgress * 0.20), y: -height * 0.40 + sandProgress * height * 0.18))
        topSand.addLine(to: CGPoint(x: 0, y: -height * 0.06))
        topSand.closeSubpath()
        hourglassContext.fill(topSand, with: .color(reviewReactionYellowColor().opacity(opacity * 0.88)))

        var bottomSand = Path()
        bottomSand.move(to: CGPoint(x: 0, y: height * 0.08))
        bottomSand.addLine(to: CGPoint(x: width * (0.12 + sandProgress * 0.24), y: height * 0.39))
        bottomSand.addLine(to: CGPoint(x: -width * (0.12 + sandProgress * 0.24), y: height * 0.39))
        bottomSand.closeSubpath()
        hourglassContext.fill(bottomSand, with: .color(reviewReactionOrangeColor().opacity(opacity)))

        let fallingLineHeight = height * (0.12 + sandProgress * 0.22)
        var fallingSand = Path()
        fallingSand.move(to: CGPoint(x: 0, y: -height * 0.04))
        fallingSand.addLine(to: CGPoint(x: 0, y: -height * 0.04 + fallingLineHeight))
        hourglassContext.stroke(
            fallingSand,
            with: .color(reviewReactionYellowColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 4, lineCap: .round)
        )
    }

    static func drawHardFallingWeight(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.52, exitStart: 0.82)
        let fallProgress = motionMode == .reduced ? 1 : reviewReactionEaseInCubic(progress: phase.enter)
        let impact = max(0, min((progress - 0.50) / 0.22, 1))
        let rebound = motionMode == .reduced ? 0 : sin(phase.hold * CGFloat.pi * 2.2) * (1 - phase.hold)
        let center = CGPoint(
            x: size.width * 0.50,
            y: motionMode == .reduced
                ? size.height * 0.45
                : reviewReactionInterpolate(start: size.height * -0.16, end: size.height * 0.52, progress: fallProgress) - rebound * 24 + phase.exit * 22
        )
        let radius = min(size.width, size.height) * 0.12
        let squash = motionMode == .reduced ? 0 : sin(impact * CGFloat.pi) * 0.18
        let stretch = motionMode == .reduced ? 0 : (1 - phase.enter) * 0.16

        drawWeight(
            context: context,
            center: center,
            radius: radius,
            xScale: 1 + squash - stretch * 0.40,
            yScale: 1 - squash * 0.55 + stretch,
            opacity: opacity
        )

        if impact > 0 {
            drawImpactLines(
                context: context,
                center: CGPoint(x: center.x, y: center.y + radius * 0.72),
                radius: radius * 1.25,
                progress: impact,
                color: reviewReactionYellowColor(),
                opacity: opacity
            )
        }
    }

    static func drawHardYellowCrack(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.64, exitStart: 0.82)
        let drawProgress = motionMode == .reduced ? 1 : min(phase.enter * 1.12, 1)
        let centerY = size.height * 0.45
        let impactGlow = motionMode == .reduced ? 0 : sin(min(phase.enter, 1) * CGFloat.pi)
        var crack = Path()
        let points: [CGPoint] = [
            CGPoint(x: size.width * 0.16, y: centerY - 40),
            CGPoint(x: size.width * 0.29, y: centerY - 12),
            CGPoint(x: size.width * 0.38, y: centerY - 35),
            CGPoint(x: size.width * 0.49, y: centerY + 6),
            CGPoint(x: size.width * 0.57, y: centerY - 8),
            CGPoint(x: size.width * 0.68, y: centerY + 42),
            CGPoint(x: size.width * 0.82, y: centerY + 14)
        ]

        if let firstPoint = points.first {
            crack.move(to: firstPoint)
        }
        for point in points.dropFirst() {
            crack.addLine(to: point)
        }

        let visibleCrack = crack.trimmedPath(from: 0, to: drawProgress)
        context.stroke(
            visibleCrack,
            with: .color(Color.black.opacity(opacity * 0.32)),
            style: StrokeStyle(lineWidth: 13, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            visibleCrack,
            with: .color(reviewReactionYellowColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            visibleCrack,
            with: .color(Color.white.opacity(opacity * 0.75)),
            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
        )

        let branches: [[CGPoint]] = [
            [CGPoint(x: size.width * 0.38, y: centerY - 35), CGPoint(x: size.width * 0.34, y: centerY - 74), CGPoint(x: size.width * 0.28, y: centerY - 92)],
            [CGPoint(x: size.width * 0.57, y: centerY - 8), CGPoint(x: size.width * 0.62, y: centerY - 48), CGPoint(x: size.width * 0.69, y: centerY - 62)],
            [CGPoint(x: size.width * 0.68, y: centerY + 42), CGPoint(x: size.width * 0.63, y: centerY + 74), CGPoint(x: size.width * 0.57, y: centerY + 86)]
        ]
        for (index, branchPoints) in branches.enumerated() {
            let branchProgress = motionMode == .reduced
                ? 1
                : reviewReactionClampedProgress(progress: (phase.enter - CGFloat(index) * 0.18) / 0.62)
            var branch = Path()
            if let firstPoint = branchPoints.first {
                branch.move(to: firstPoint)
            }
            for point in branchPoints.dropFirst() {
                branch.addLine(to: point)
            }
            let visibleBranch = branch.trimmedPath(from: 0, to: branchProgress)
            context.stroke(
                visibleBranch,
                with: .color(reviewReactionYellowColor().opacity(opacity * (0.70 + impactGlow * 0.30))),
                style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
            )
            context.stroke(
                visibleBranch,
                with: .color(Color.white.opacity(opacity * 0.55)),
                style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round)
            )
        }
    }

    static func drawHardRollingBoulder(
        context: GraphicsContext,
        size: CGSize,
        progress: CGFloat,
        motionMode: ReviewReactionMotionMode
    ) {
        let opacity = reviewReactionOpacity(progress: progress)
        guard opacity > 0 else {
            return
        }

        let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.62, exitStart: 0.82)
        let radius = min(size.width, size.height) * 0.12
        let baseY = size.height * 0.60
        let targetCenter = CGPoint(x: size.width * 0.54, y: baseY)
        let center: CGPoint
        if motionMode == .reduced {
            center = targetCenter
        } else if progress < 0.62 {
            let travel = reviewReactionEaseInOut(progress: phase.enter)
            let hop = abs(sin(phase.enter * CGFloat.pi * 3)) * 22 * (1 - phase.enter * 0.35)
            center = CGPoint(
                x: reviewReactionInterpolate(start: -radius * 1.4, end: targetCenter.x, progress: travel),
                y: baseY - hop
            )
        } else if progress < 0.82 {
            center = CGPoint(
                x: targetCenter.x + sin(phase.hold * CGFloat.pi * 2) * 10 * (1 - phase.hold),
                y: baseY - abs(sin(phase.hold * CGFloat.pi * 2)) * 9 * (1 - phase.hold)
            )
        } else {
            let exit = reviewReactionEaseInCubic(progress: phase.exit)
            center = CGPoint(
                x: reviewReactionInterpolate(start: targetCenter.x, end: size.width + radius * 1.4, progress: exit),
                y: baseY - sin(phase.exit * CGFloat.pi) * 18
            )
        }
        let radiusScale = motionMode == .reduced ? 1 : 0.92 + sin(progress * CGFloat.pi * 3.5) * 0.05 + phase.enter * 0.08
        let rotationDegrees = motionMode == .reduced ? -12 : reviewReactionEaseInOut(progress: progress) * 900
        drawBoulder(
            context: context,
            center: center,
            radius: radius * radiusScale,
            rotationDegrees: rotationDegrees,
            opacity: opacity
        )
        drawDustCloud(
            context: context,
            origin: CGPoint(x: center.x - radius * 1.1, y: center.y + radius * 0.55),
            progress: progress,
            opacity: opacity
        )
    }
}
