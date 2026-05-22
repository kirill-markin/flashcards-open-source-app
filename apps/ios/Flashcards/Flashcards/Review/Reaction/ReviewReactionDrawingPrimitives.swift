import SwiftUI

extension ReviewReactionRenderer {
    static func drawWarningTapeBand(
        context: GraphicsContext,
        center: CGPoint,
        length: CGFloat,
        height: CGFloat,
        rotationDegrees: CGFloat,
        opacity: Double
    ) {
        let tapeContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: 1
        )
        var tape = Path()
        tape.addRoundedRect(
            in: CGRect(x: -length / 2, y: -height / 2, width: length, height: height),
            cornerSize: CGSize(width: height * 0.20, height: height * 0.20)
        )
        tapeContext.fill(tape, with: .color(reviewReactionYellowColor().opacity(opacity)))
        tapeContext.stroke(
            tape,
            with: .color(Color.black.opacity(opacity * 0.45)),
            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
        )

        for stripeX in stride(from: -length / 2 - 40, through: length / 2 + 40, by: 38) {
            var stripe = Path()
            stripe.move(to: CGPoint(x: stripeX - 14, y: -height / 2))
            stripe.addLine(to: CGPoint(x: stripeX + 2, y: -height / 2))
            stripe.addLine(to: CGPoint(x: stripeX + 28, y: height / 2))
            stripe.addLine(to: CGPoint(x: stripeX + 12, y: height / 2))
            stripe.closeSubpath()
            tapeContext.fill(stripe, with: .color(Color.black.opacity(opacity * 0.70)))
        }
    }

    static func drawWeight(
        context: GraphicsContext,
        center: CGPoint,
        radius: CGFloat,
        xScale: CGFloat,
        yScale: CGFloat,
        opacity: Double
    ) {
        var weightContext = context
        weightContext.translateBy(x: center.x, y: center.y)
        weightContext.rotate(by: .degrees(-4))
        weightContext.scaleBy(x: xScale, y: yScale)

        let handleRect = CGRect(x: -radius * 0.54, y: -radius * 1.10, width: radius * 1.08, height: radius * 0.70)
        var handle = Path()
        handle.addRoundedRect(
            in: handleRect,
            cornerSize: CGSize(width: radius * 0.30, height: radius * 0.30)
        )
        weightContext.stroke(
            handle,
            with: .color(Color.gray.opacity(opacity)),
            style: StrokeStyle(lineWidth: radius * 0.18, lineCap: .round, lineJoin: .round)
        )
        weightContext.fill(
            Path(ellipseIn: CGRect(x: -radius, y: -radius * 0.58, width: radius * 2, height: radius * 1.72)),
            with: .color(Color.gray.opacity(opacity * 0.95))
        )
        weightContext.fill(
            Path(ellipseIn: CGRect(x: -radius * 0.52, y: -radius * 0.18, width: radius * 1.04, height: radius * 0.70)),
            with: .color(Color.black.opacity(opacity * 0.20))
        )
    }

    static func drawImpactLines(
        context: GraphicsContext,
        center: CGPoint,
        radius: CGFloat,
        progress: CGFloat,
        color: Color,
        opacity: Double
    ) {
        for index in 0..<8 {
            let angle = CGFloat.pi + CGFloat(index) * CGFloat.pi / 7
            let inner = pointOnCircle(center: center, radius: radius * 0.36, angle: angle)
            let outer = pointOnCircle(center: center, radius: radius * (0.48 + progress * 0.52), angle: angle)
            var path = Path()
            path.move(to: inner)
            path.addLine(to: outer)
            context.stroke(
                path,
                with: .color(color.opacity(opacity * Double(1 - progress * 0.45))),
                style: StrokeStyle(lineWidth: 4, lineCap: .round)
            )
        }
    }

    static func drawBoulder(
        context: GraphicsContext,
        center: CGPoint,
        radius: CGFloat,
        rotationDegrees: CGFloat,
        opacity: Double
    ) {
        let boulderContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: 1
        )
        boulderContext.fill(
            Path(ellipseIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2)),
            with: .color(Color.gray.opacity(opacity))
        )
        boulderContext.stroke(
            Path(ellipseIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2)),
            with: .color(Color.black.opacity(opacity * 0.35)),
            style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
        )

        let cracks: [[CGPoint]] = [
            [CGPoint(x: -radius * 0.42, y: -radius * 0.22), CGPoint(x: -radius * 0.10, y: -radius * 0.02), CGPoint(x: -radius * 0.30, y: radius * 0.28)],
            [CGPoint(x: radius * 0.18, y: -radius * 0.40), CGPoint(x: radius * 0.42, y: -radius * 0.08), CGPoint(x: radius * 0.20, y: radius * 0.14)]
        ]
        for crackPoints in cracks {
            var path = Path()
            if let firstPoint = crackPoints.first {
                path.move(to: firstPoint)
            }
            for point in crackPoints.dropFirst() {
                path.addLine(to: point)
            }
            boulderContext.stroke(
                path,
                with: .color(Color.black.opacity(opacity * 0.22)),
                style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
            )
        }
    }

    static func drawDustCloud(
        context: GraphicsContext,
        origin: CGPoint,
        progress: CGFloat,
        opacity: Double
    ) {
        for index in 0..<7 {
            let localProgress = min(max(progress * 1.2 - CGFloat(index) * 0.04, 0), 1)
            let radius = CGFloat(5 + index % 3 * 4) * (1 + localProgress)
            let center = CGPoint(
                x: origin.x - CGFloat(index) * 18 * localProgress,
                y: origin.y + sin(CGFloat(index)) * 8 - localProgress * 10
            )
            context.fill(
                Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
                with: .color(Color.gray.opacity(opacity * Double(0.35 * (1 - localProgress * 0.65))))
            )
        }
    }

    static func drawCheckMark(
        context: GraphicsContext,
        center: CGPoint,
        width: CGFloat,
        color: Color,
        lineWidth: CGFloat,
        progress: CGFloat,
        opacity: Double
    ) {
        var path = Path()
        path.move(to: CGPoint(x: center.x - width * 0.42, y: center.y + width * 0.03))
        path.addLine(to: CGPoint(x: center.x - width * 0.12, y: center.y + width * 0.30))
        path.addLine(to: CGPoint(x: center.x + width * 0.46, y: center.y - width * 0.32))

        let visiblePath = path.trimmedPath(from: 0, to: min(max(progress, 0), 1))
        context.stroke(
            visiblePath,
            with: .color(Color.black.opacity(opacity * 0.24)),
            style: StrokeStyle(lineWidth: lineWidth * 1.42, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            visiblePath,
            with: .color(color.opacity(opacity)),
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            visiblePath,
            with: .color(Color.white.opacity(opacity * 0.55)),
            style: StrokeStyle(lineWidth: max(lineWidth * 0.22, 1), lineCap: .round, lineJoin: .round)
        )
    }

    static func drawPaperPlane(
        context: GraphicsContext,
        center: CGPoint,
        scale: CGFloat,
        rotationDegrees: CGFloat,
        opacity: Double
    ) {
        let planeContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: scale
        )
        var plane = Path()
        plane.move(to: CGPoint(x: 82, y: -6))
        plane.addLine(to: CGPoint(x: -64, y: -46))
        plane.addLine(to: CGPoint(x: -22, y: 4))
        plane.addLine(to: CGPoint(x: -58, y: 50))
        plane.closeSubpath()
        planeContext.fill(plane, with: .color(Color.white.opacity(opacity * 0.96)))
        planeContext.stroke(
            plane,
            with: .color(reviewReactionGreenColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
        )

        var fold = Path()
        fold.move(to: CGPoint(x: -22, y: 4))
        fold.addLine(to: CGPoint(x: 82, y: -6))
        fold.addLine(to: CGPoint(x: -64, y: -46))
        planeContext.stroke(
            fold,
            with: .color(reviewReactionBlueColor().opacity(opacity * 0.54)),
            style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
        )
    }

    static func drawCheckSeal(
        context: GraphicsContext,
        center: CGPoint,
        radius: CGFloat,
        scale: CGFloat,
        rotationDegrees: CGFloat,
        opacity: Double
    ) {
        let sealContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: scale
        )
        let sealPath = makeScallopedSealPath(radius: radius, teeth: 34, inset: 0.07)
        sealContext.fill(sealPath, with: .color(reviewReactionGreenColor().opacity(opacity * 0.94)))
        sealContext.stroke(
            sealPath,
            with: .color(Color.white.opacity(opacity * 0.86)),
            style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round)
        )
        drawCheckMark(
            context: sealContext,
            center: .zero,
            width: radius * 1.16,
            color: .white,
            lineWidth: radius * 0.14,
            progress: 1,
            opacity: opacity
        )
    }

    static func drawSparkle(
        context: GraphicsContext,
        center: CGPoint,
        radius: CGFloat,
        rotation: CGFloat,
        color: Color,
        opacity: Double
    ) {
        var sparkle = Path()
        for index in 0..<8 {
            let pointRadius = index.isMultiple(of: 2) ? radius : radius * 0.30
            let angle = rotation + CGFloat(index) * CGFloat.pi / 4
            let point = pointOnCircle(center: center, radius: pointRadius, angle: angle)
            if index == 0 {
                sparkle.move(to: point)
            } else {
                sparkle.addLine(to: point)
            }
        }
        sparkle.closeSubpath()
        context.fill(sparkle, with: .color(color.opacity(opacity)))
    }

    static func drawCrown(
        context: GraphicsContext,
        center: CGPoint,
        scale: CGFloat,
        rotationDegrees: CGFloat,
        opacity: Double
    ) {
        let crownContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: rotationDegrees,
            scale: scale
        )
        var crown = Path()
        crown.move(to: CGPoint(x: -58, y: 34))
        crown.addLine(to: CGPoint(x: -48, y: -30))
        crown.addLine(to: CGPoint(x: -18, y: 6))
        crown.addLine(to: CGPoint(x: 0, y: -48))
        crown.addLine(to: CGPoint(x: 18, y: 6))
        crown.addLine(to: CGPoint(x: 48, y: -30))
        crown.addLine(to: CGPoint(x: 58, y: 34))
        crown.closeSubpath()
        crownContext.fill(crown, with: .color(reviewReactionYellowColor().opacity(opacity)))
        crownContext.stroke(
            crown,
            with: .color(reviewReactionOrangeColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
        )

        var base = Path()
        base.addRoundedRect(
            in: CGRect(x: -62, y: 22, width: 124, height: 28),
            cornerSize: CGSize(width: 10, height: 10)
        )
        crownContext.fill(base, with: .color(reviewReactionOrangeColor().opacity(opacity)))
    }

    static func drawRainbowTrail(
        context: GraphicsContext,
        headCenter: CGPoint,
        size: CGSize,
        progress: CGFloat,
        opacity: Double,
        motionMode: ReviewReactionMotionMode
    ) {
        let trailLength = motionMode == .reduced ? size.width * 0.24 : size.width * 0.42
        let colors: [Color] = [
            reviewReactionRedColor(),
            reviewReactionOrangeColor(),
            reviewReactionYellowColor(),
            reviewReactionGreenColor(),
            reviewReactionBlueColor(),
            reviewReactionPurpleColor()
        ]
        for index in 0..<colors.count {
            var path = Path()
            let start = CGPoint(x: headCenter.x + 6, y: headCenter.y + CGFloat(index - 3) * 6)
            let wave = sin(progress * CGFloat.pi * 4 + CGFloat(index) * 0.62)
            path.move(to: start)
            path.addCurve(
                to: CGPoint(x: start.x + trailLength, y: start.y + wave * 14),
                control1: CGPoint(x: start.x + trailLength * 0.30, y: start.y - 22 + wave * 8),
                control2: CGPoint(x: start.x + trailLength * 0.70, y: start.y + 24 - wave * 10)
            )
            context.stroke(
                path,
                with: .color(colors[index].opacity(opacity * 0.70)),
                style: StrokeStyle(lineWidth: 5 + abs(wave) * 1.5, lineCap: .round, lineJoin: .round)
            )
        }
    }

    static func drawUnicorn(
        context: GraphicsContext,
        center: CGPoint,
        scale: CGFloat,
        progress: CGFloat,
        opacity: Double
    ) {
        let unicornContext = transformedContext(
            context: context,
            center: center,
            rotationDegrees: -4 + sin(progress * CGFloat.pi * 4) * 3,
            scale: scale
        )

        unicornContext.fill(
            Path(ellipseIn: CGRect(x: -56, y: -18, width: 96, height: 44)),
            with: .color(Color.white.opacity(opacity))
        )
        unicornContext.stroke(
            Path(ellipseIn: CGRect(x: -56, y: -18, width: 96, height: 44)),
            with: .color(reviewReactionPurpleColor().opacity(opacity * 0.48)),
            style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
        )
        unicornContext.fill(
            Path(ellipseIn: CGRect(x: 26, y: -43, width: 46, height: 42)),
            with: .color(Color.white.opacity(opacity))
        )

        var horn = Path()
        horn.move(to: CGPoint(x: 60, y: -40))
        horn.addLine(to: CGPoint(x: 92, y: -64))
        horn.addLine(to: CGPoint(x: 74, y: -30))
        horn.closeSubpath()
        unicornContext.fill(horn, with: .color(reviewReactionYellowColor().opacity(opacity)))
        unicornContext.stroke(
            horn,
            with: .color(reviewReactionOrangeColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
        )

        let legXs: [CGFloat] = [-34, -8, 18, 36]
        for (index, x) in legXs.enumerated() {
            let step = sin(progress * CGFloat.pi * 8 + CGFloat(index) * CGFloat.pi / 2) * 7
            var leg = Path()
            leg.move(to: CGPoint(x: x, y: 14))
            leg.addLine(to: CGPoint(x: x - 4 + step, y: 44 - abs(step) * 0.35))
            unicornContext.stroke(
                leg,
                with: .color(Color.white.opacity(opacity)),
                style: StrokeStyle(lineWidth: 8, lineCap: .round)
            )
        }

        let maneColors: [Color] = [
            reviewReactionPinkColor(),
            reviewReactionBlueColor(),
            reviewReactionPurpleColor()
        ]
        for index in 0..<maneColors.count {
            let maneWave = sin(progress * CGFloat.pi * 5 + CGFloat(index)) * 4
            var mane = Path()
            mane.move(to: CGPoint(x: 24 + CGFloat(index) * 10, y: -24 + maneWave))
            mane.addCurve(
                to: CGPoint(x: 10 + CGFloat(index) * 8, y: 6),
                control1: CGPoint(x: 12 + CGFloat(index) * 8, y: -20),
                control2: CGPoint(x: 28 + CGFloat(index) * 7, y: -2 + maneWave)
            )
            unicornContext.stroke(
                mane,
                with: .color(maneColors[index].opacity(opacity)),
                style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round)
            )
        }

        unicornContext.fill(
            Path(ellipseIn: CGRect(x: 58, y: -26, width: 5, height: 5)),
            with: .color(Color.black.opacity(opacity * 0.76))
        )
    }

    static func drawTriangle(
        context: GraphicsContext,
        center: CGPoint,
        angle: CGFloat,
        radius: CGFloat,
        color: Color,
        opacity: Double
    ) {
        var triangle = Path()
        for index in 0..<3 {
            let point = pointOnCircle(
                center: center,
                radius: radius,
                angle: angle + CGFloat(index) * CGFloat.pi * 2 / 3
            )
            if index == 0 {
                triangle.move(to: point)
            } else {
                triangle.addLine(to: point)
            }
        }
        triangle.closeSubpath()
        context.fill(triangle, with: .color(color.opacity(opacity)))
    }
}
