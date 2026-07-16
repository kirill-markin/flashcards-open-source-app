import SwiftUI

extension ReviewReactionRenderer {
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
