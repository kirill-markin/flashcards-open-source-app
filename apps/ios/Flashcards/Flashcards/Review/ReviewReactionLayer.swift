import SwiftUI

let reviewReactionMaximumActiveEvents: Int = 3

private let reviewReactionAnimationMinimumIntervalSeconds: Double = 1.0 / 60.0
private let reviewReactionReducedMotionDurationSeconds: Double = 0.34
private let reviewReactionReducedMotionDrawingProgress: CGFloat = 0.55

enum ReviewReactionMotionMode: Hashable, Sendable {
    case standard
    case reduced
}

enum ReviewReactionRating: CaseIterable, Hashable, Sendable {
    case again
    case hard
    case good
    case easy
}

enum ReviewReactionVariant: CaseIterable, Hashable, Sendable {
    case againRedScribbleSlash
    case againRewindVortex
    case againStampFlyby
    case againWarningTape
    case hardHourglassSand
    case hardFallingWeight
    case hardYellowCrack
    case hardRollingBoulder
    case goodHandDrawnCheck
    case goodLightSweep
    case goodPaperPlaneCheck
    case goodCheckSealBounce
    case easySparkleBurst
    case easyRainbowStreak
    case easyCrownBounce
    case easyUnicornFlyby

    var animationDurationSeconds: Double {
        switch self {
        case .againRedScribbleSlash, .hardYellowCrack, .goodHandDrawnCheck, .easySparkleBurst:
            return 0.52
        case .againRewindVortex, .hardHourglassSand, .goodLightSweep, .easyRainbowStreak:
            return 0.62
        case .againStampFlyby, .hardFallingWeight, .goodPaperPlaneCheck, .easyCrownBounce:
            return 0.72
        case .againWarningTape, .hardRollingBoulder, .goodCheckSealBounce, .easyUnicornFlyby:
            return 0.88
        }
    }

    var cleanupDelayNanoseconds: UInt64 {
        let cleanupDelaySeconds = min(self.animationDurationSeconds + 0.06, 0.95)
        return UInt64(cleanupDelaySeconds * 1_000_000_000)
    }
}

func reviewReactionCleanupDelayNanoseconds(
    variant: ReviewReactionVariant,
    motionMode: ReviewReactionMotionMode
) -> UInt64 {
    switch motionMode {
    case .standard:
        return variant.cleanupDelayNanoseconds
    case .reduced:
        return UInt64((reviewReactionReducedMotionDurationSeconds + 0.06) * 1_000_000_000)
    }
}

struct ReviewReactionEvent: Identifiable, Hashable, Sendable {
    let id: UUID
    let rating: ReviewReactionRating
    let variant: ReviewReactionVariant
}

func selectReviewReactionVariant(
    rating: ReviewReactionRating,
    roll: Int
) -> ReviewReactionVariant {
    precondition((0...999).contains(roll), "Review reaction roll must be in 0...999, received \(roll).")

    switch rating {
    case .again:
        if roll <= 399 {
            return .againRedScribbleSlash
        }
        if roll <= 699 {
            return .againRewindVortex
        }
        if roll <= 919 {
            return .againStampFlyby
        }
        return .againWarningTape
    case .hard:
        if roll <= 399 {
            return .hardHourglassSand
        }
        if roll <= 699 {
            return .hardFallingWeight
        }
        if roll <= 919 {
            return .hardYellowCrack
        }
        return .hardRollingBoulder
    case .good:
        if roll <= 399 {
            return .goodHandDrawnCheck
        }
        if roll <= 699 {
            return .goodLightSweep
        }
        if roll <= 919 {
            return .goodPaperPlaneCheck
        }
        return .goodCheckSealBounce
    case .easy:
        if roll <= 399 {
            return .easySparkleBurst
        }
        if roll <= 699 {
            return .easyRainbowStreak
        }
        if roll <= 919 {
            return .easyCrownBounce
        }
        return .easyUnicornFlyby
    }
}

func makeReviewReactionRating(rating: ReviewRating) -> ReviewReactionRating {
    switch rating {
    case .again:
        return .again
    case .hard:
        return .hard
    case .good:
        return .good
    case .easy:
        return .easy
    }
}

func appendReviewReactionEvent(
    events: [ReviewReactionEvent],
    event: ReviewReactionEvent,
    maximumActiveEvents: Int
) -> [ReviewReactionEvent] {
    precondition(maximumActiveEvents > 0, "Review reactions require at least one active event slot.")

    let nextEvents = events + [event]
    guard nextEvents.count > maximumActiveEvents else {
        return nextEvents
    }

    return Array(nextEvents.suffix(maximumActiveEvents))
}

struct ReviewReactionLayer: View {
    @Environment(\.accessibilityReduceMotion) private var isReduceMotionEnabled

    let events: [ReviewReactionEvent]

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                ForEach(self.events) { event in
                    ReviewReactionCanvas(
                        event: event,
                        isReduceMotionEnabled: self.isReduceMotionEnabled
                    )
                    .id(event.id)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct ReviewReactionCanvas: View {
    let event: ReviewReactionEvent
    let isReduceMotionEnabled: Bool

    @State private var startedAt: Date = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: reviewReactionAnimationMinimumIntervalSeconds)) { timelineContext in
            let progress = self.progress(date: timelineContext.date)

            Canvas(rendersAsynchronously: true) { context, size in
                drawReviewReaction(
                    context: context,
                    size: size,
                    event: self.event,
                    progress: progress,
                    motionMode: self.motionMode
                )
            }
        }
    }

    private var motionMode: ReviewReactionMotionMode {
        self.isReduceMotionEnabled ? .reduced : .standard
    }

    private func progress(date: Date) -> CGFloat {
        let durationSeconds: Double
        switch self.motionMode {
        case .standard:
            durationSeconds = self.event.variant.animationDurationSeconds
        case .reduced:
            durationSeconds = reviewReactionReducedMotionDurationSeconds
        }

        let elapsedSeconds = date.timeIntervalSince(self.startedAt)
        return reviewReactionClampedProgress(progress: CGFloat(elapsedSeconds / durationSeconds))
    }
}

private func drawReviewReaction(
    context: GraphicsContext,
    size: CGSize,
    event: ReviewReactionEvent,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let drawableSize = CGSize(
        width: max(size.width, 1),
        height: max(size.height, 1)
    )
    var drawingContext = context
    let drawingProgress = reviewReactionDrawingProgress(
        progress: progress,
        motionMode: motionMode
    )
    if motionMode == .reduced {
        drawingContext.opacity = reviewReactionOpacity(progress: progress)
    }

    switch event.variant {
    case .againRedScribbleSlash:
        drawAgainRedScribbleSlash(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .againRewindVortex:
        drawAgainRewindVortex(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .againStampFlyby:
        drawAgainStampFlyby(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .againWarningTape:
        drawAgainWarningTape(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .hardHourglassSand:
        drawHardHourglassSand(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .hardFallingWeight:
        drawHardFallingWeight(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .hardYellowCrack:
        drawHardYellowCrack(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .hardRollingBoulder:
        drawHardRollingBoulder(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .goodHandDrawnCheck:
        drawGoodHandDrawnCheck(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .goodLightSweep:
        drawGoodLightSweep(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .goodPaperPlaneCheck:
        drawGoodPaperPlaneCheck(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .goodCheckSealBounce:
        drawGoodCheckSealBounce(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .easySparkleBurst:
        drawEasySparkleBurst(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .easyRainbowStreak:
        drawEasyRainbowStreak(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .easyCrownBounce:
        drawEasyCrownBounce(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    case .easyUnicornFlyby:
        drawEasyUnicornFlyby(
            context: drawingContext,
            size: drawableSize,
            progress: drawingProgress,
            motionMode: motionMode
        )
    }
}

private func drawAgainRedScribbleSlash(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let drawProgress = motionMode == .reduced ? 1 : min(progress * 1.35, 1)
    let width = size.width
    let height = size.height
    let startX = motionMode == .reduced ? width * 0.18 : width * -0.08
    let endX = motionMode == .reduced ? width * 0.82 : width * 1.08
    let startY = motionMode == .reduced ? height * 0.30 : height * 0.20
    let endY = motionMode == .reduced ? height * 0.63 : height * 0.78
    let offsets: [CGFloat] = [-12, 7, 19]

    for offset in offsets {
        var path = Path()
        path.move(to: CGPoint(x: startX, y: startY + offset))
        path.addCurve(
            to: CGPoint(x: endX, y: endY + offset * 0.35),
            control1: CGPoint(x: width * 0.28, y: height * 0.26 + offset * 0.6),
            control2: CGPoint(x: width * 0.64, y: height * 0.70 - offset * 0.4)
        )

        let trimmedPath = path.trimmedPath(from: 0, to: drawProgress)
        context.stroke(
            trimmedPath,
            with: .color(reviewReactionRedColor().opacity(opacity * 0.30)),
            style: StrokeStyle(lineWidth: 18, lineCap: .round, lineJoin: .round)
        )
        context.stroke(
            trimmedPath,
            with: .color(reviewReactionRedColor().opacity(opacity)),
            style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round)
        )
    }
}

private func drawAgainRewindVortex(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let center = CGPoint(x: size.width * 0.50, y: size.height * 0.45)
    let maxRadius = min(size.width, size.height) * (motionMode == .reduced ? 0.20 : 0.31)
    let drawProgress = motionMode == .reduced ? 1 : min(progress * 1.18, 1)
    let rotation = motionMode == .reduced ? 0 : progress * CGFloat.pi * 1.25
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

private func drawAgainStampFlyby(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = reviewReactionEaseOutCubic(progress: progress)
    let center: CGPoint
    if motionMode == .reduced {
        center = CGPoint(x: size.width * 0.50, y: size.height * 0.42)
    } else {
        center = CGPoint(
            x: reviewReactionInterpolate(start: size.width * -0.18, end: size.width * 1.18, progress: travel),
            y: reviewReactionInterpolate(start: size.height * 0.30, end: size.height * 0.58, progress: travel)
        )
    }
    let bounce = sin(progress * CGFloat.pi)
    let radius = min(size.width, size.height) * 0.12
    let scale = motionMode == .reduced ? 0.95 + bounce * 0.08 : 0.82 + bounce * 0.38
    let rotationDegrees = motionMode == .reduced ? -8 : reviewReactionInterpolate(start: -24, end: 18, progress: progress)
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

private func drawAgainWarningTape(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let shift = motionMode == .reduced ? 0 : reviewReactionInterpolate(start: -36, end: 36, progress: progress)
    drawWarningTapeBand(
        context: context,
        center: CGPoint(x: size.width * 0.50 + shift, y: size.height * 0.32),
        length: size.width * 1.30,
        height: 34,
        rotationDegrees: -13,
        opacity: opacity
    )
    drawWarningTapeBand(
        context: context,
        center: CGPoint(x: size.width * 0.50 - shift, y: size.height * 0.58),
        length: size.width * 1.24,
        height: 28,
        rotationDegrees: 12,
        opacity: opacity * 0.82
    )
}

private func drawHardHourglassSand(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let center = CGPoint(x: size.width * 0.50, y: size.height * 0.42)
    let height = min(size.height * 0.34, 210)
    let width = height * 0.50
    let sandProgress = motionMode == .reduced ? 0.60 : reviewReactionEaseInOut(progress: min(progress * 1.2, 1))
    var glass = Path()
    glass.move(to: CGPoint(x: center.x - width * 0.48, y: center.y - height * 0.50))
    glass.addLine(to: CGPoint(x: center.x + width * 0.48, y: center.y - height * 0.50))
    glass.addLine(to: CGPoint(x: center.x, y: center.y))
    glass.addLine(to: CGPoint(x: center.x + width * 0.48, y: center.y + height * 0.50))
    glass.addLine(to: CGPoint(x: center.x - width * 0.48, y: center.y + height * 0.50))
    glass.addLine(to: CGPoint(x: center.x, y: center.y))
    glass.closeSubpath()

    context.stroke(
        glass,
        with: .color(reviewReactionYellowColor().opacity(opacity)),
        style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
    )

    var topSand = Path()
    topSand.move(to: CGPoint(x: center.x - width * (0.38 - sandProgress * 0.20), y: center.y - height * 0.40 + sandProgress * height * 0.18))
    topSand.addLine(to: CGPoint(x: center.x + width * (0.38 - sandProgress * 0.20), y: center.y - height * 0.40 + sandProgress * height * 0.18))
    topSand.addLine(to: CGPoint(x: center.x, y: center.y - height * 0.06))
    topSand.closeSubpath()
    context.fill(topSand, with: .color(reviewReactionYellowColor().opacity(opacity * 0.88)))

    var bottomSand = Path()
    bottomSand.move(to: CGPoint(x: center.x, y: center.y + height * 0.08))
    bottomSand.addLine(to: CGPoint(x: center.x + width * (0.12 + sandProgress * 0.24), y: center.y + height * 0.39))
    bottomSand.addLine(to: CGPoint(x: center.x - width * (0.12 + sandProgress * 0.24), y: center.y + height * 0.39))
    bottomSand.closeSubpath()
    context.fill(bottomSand, with: .color(reviewReactionOrangeColor().opacity(opacity)))

    let fallingLineHeight = height * (0.12 + sandProgress * 0.22)
    var fallingSand = Path()
    fallingSand.move(to: CGPoint(x: center.x, y: center.y - height * 0.04))
    fallingSand.addLine(to: CGPoint(x: center.x, y: center.y - height * 0.04 + fallingLineHeight))
    context.stroke(
        fallingSand,
        with: .color(reviewReactionYellowColor().opacity(opacity)),
        style: StrokeStyle(lineWidth: 4, lineCap: .round)
    )
}

private func drawHardFallingWeight(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let fallProgress = motionMode == .reduced ? 1 : reviewReactionEaseOutCubic(progress: min(progress * 1.15, 1))
    let impact = max(0, min((progress - 0.58) / 0.26, 1))
    let center = CGPoint(
        x: size.width * 0.50,
        y: motionMode == .reduced
            ? size.height * 0.45
            : reviewReactionInterpolate(start: size.height * -0.12, end: size.height * 0.52, progress: fallProgress)
    )
    let radius = min(size.width, size.height) * 0.12
    let scale = motionMode == .reduced ? 0.95 : 1 + sin(progress * CGFloat.pi) * 0.10

    drawWeight(
        context: context,
        center: center,
        radius: radius,
        scale: scale,
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

private func drawHardYellowCrack(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let drawProgress = motionMode == .reduced ? 1 : min(progress * 1.45, 1)
    let centerY = size.height * 0.45
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
}

private func drawHardRollingBoulder(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = reviewReactionEaseOutCubic(progress: progress)
    let radius = min(size.width, size.height) * 0.12
    let center = CGPoint(
        x: motionMode == .reduced
            ? size.width * 0.50
            : reviewReactionInterpolate(start: -radius * 1.2, end: size.width + radius * 1.2, progress: travel),
        y: size.height * 0.60
    )
    let rotationDegrees = motionMode == .reduced ? -12 : progress * 720
    drawBoulder(
        context: context,
        center: center,
        radius: radius,
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

private func drawGoodHandDrawnCheck(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let drawProgress = motionMode == .reduced ? 1 : min(progress * 1.28, 1)
    drawCheckMark(
        context: context,
        center: CGPoint(x: size.width * 0.50, y: size.height * 0.43),
        width: min(size.width * 0.58, 320),
        color: reviewReactionGreenColor(),
        lineWidth: 15,
        progress: drawProgress,
        opacity: opacity
    )
}

private func drawGoodLightSweep(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = motionMode == .reduced ? 0.50 : reviewReactionEaseInOut(progress: progress)
    let center = CGPoint(
        x: reviewReactionInterpolate(start: -size.width * 0.20, end: size.width * 1.20, progress: travel),
        y: size.height * 0.45
    )
    let beamLength = size.height * 1.25
    let beamWidths: [CGFloat] = [70, 38, 12]
    let colors: [Color] = [
        reviewReactionYellowColor(),
        Color.white,
        reviewReactionGreenColor()
    ]

    for index in 0..<beamWidths.count {
        drawBeam(
            context: context,
            center: center,
            length: beamLength,
            width: beamWidths[index],
            rotationDegrees: 22,
            color: colors[index],
            opacity: opacity * Double(0.16 + CGFloat(index) * 0.18)
        )
    }
}

private func drawGoodPaperPlaneCheck(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = reviewReactionEaseOutCubic(progress: progress)
    let center = CGPoint(
        x: motionMode == .reduced
            ? size.width * 0.50
            : reviewReactionInterpolate(start: size.width * 0.12, end: size.width * 0.82, progress: travel),
        y: motionMode == .reduced
            ? size.height * 0.42
            : reviewReactionInterpolate(start: size.height * 0.64, end: size.height * 0.26, progress: travel)
    )
    let scale = min(size.width, size.height) / 390
    drawPaperPlane(
        context: context,
        center: center,
        scale: scale,
        rotationDegrees: -18,
        opacity: opacity
    )
    drawCheckMark(
        context: context,
        center: CGPoint(x: center.x - 58 * scale, y: center.y + 48 * scale),
        width: 72 * scale,
        color: reviewReactionGreenColor(),
        lineWidth: 7 * scale,
        progress: motionMode == .reduced ? 1 : min(progress * 1.55, 1),
        opacity: opacity
    )
}

private func drawGoodCheckSealBounce(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let bounce = sin(progress * CGFloat.pi)
    let scale = motionMode == .reduced ? 0.95 + bounce * 0.08 : 0.78 + bounce * 0.34
    drawCheckSeal(
        context: context,
        center: CGPoint(x: size.width * 0.50, y: size.height * 0.43 - bounce * 14),
        radius: min(size.width, size.height) * 0.13,
        scale: scale,
        opacity: opacity
    )
}

private func drawEasySparkleBurst(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let center = CGPoint(x: size.width * 0.50, y: size.height * 0.40)
    let burstProgress = motionMode == .reduced ? 0.65 : reviewReactionEaseOutCubic(progress: min(progress * 1.18, 1))
    let colors: [Color] = [
        reviewReactionYellowColor(),
        reviewReactionPinkColor(),
        reviewReactionBlueColor(),
        reviewReactionGreenColor()
    ]
    for index in 0..<18 {
        let angle = CGFloat(index) * CGFloat.pi * 2 / 18
        let distance = min(size.width, size.height) * (0.08 + 0.24 * burstProgress)
        let point = pointOnCircle(center: center, radius: distance, angle: angle)
        if index.isMultiple(of: 3) {
            drawSparkle(
                context: context,
                center: point,
                radius: 12 + CGFloat(index % 4) * 2,
                rotation: angle + progress * CGFloat.pi,
                color: colors[index % colors.count],
                opacity: opacity
            )
        } else {
            context.fill(
                Path(ellipseIn: CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)),
                with: .color(colors[index % colors.count].opacity(opacity))
            )
        }
    }
}

private func drawEasyRainbowStreak(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = motionMode == .reduced ? 0.50 : reviewReactionEaseInOut(progress: progress)
    let center = CGPoint(
        x: reviewReactionInterpolate(start: -size.width * 0.24, end: size.width * 1.24, progress: travel),
        y: size.height * 0.44
    )
    let colors: [Color] = [
        reviewReactionRedColor(),
        reviewReactionOrangeColor(),
        reviewReactionYellowColor(),
        reviewReactionGreenColor(),
        reviewReactionBlueColor(),
        reviewReactionPurpleColor()
    ]

    for index in 0..<colors.count {
        drawBeam(
            context: context,
            center: CGPoint(x: center.x, y: center.y + CGFloat(index - 2) * 11),
            length: size.width * 0.92,
            width: 10,
            rotationDegrees: -16,
            color: colors[index],
            opacity: opacity * 0.78
        )
    }
}

private func drawEasyCrownBounce(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let bounce = sin(progress * CGFloat.pi)
    let center = CGPoint(
        x: size.width * 0.50,
        y: size.height * 0.40 - (motionMode == .reduced ? 0 : bounce * 36)
    )
    drawCrown(
        context: context,
        center: center,
        scale: min(size.width, size.height) / 360 * (0.92 + bounce * 0.18),
        rotationDegrees: motionMode == .reduced ? -3 : reviewReactionInterpolate(start: -11, end: 7, progress: progress),
        opacity: opacity
    )
    drawSparkle(
        context: context,
        center: CGPoint(x: center.x + 76, y: center.y - 48),
        radius: 14,
        rotation: progress * CGFloat.pi,
        color: reviewReactionYellowColor(),
        opacity: opacity
    )
}

private func drawEasyUnicornFlyby(
    context: GraphicsContext,
    size: CGSize,
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) {
    let opacity = reviewReactionOpacity(progress: progress)
    guard opacity > 0 else {
        return
    }

    let travel = reviewReactionEaseInOut(progress: progress)
    let center = CGPoint(
        x: motionMode == .reduced
            ? size.width * 0.50
            : reviewReactionInterpolate(start: size.width * 1.18, end: size.width * -0.18, progress: travel),
        y: size.height * 0.27 + (motionMode == .reduced ? 0 : sin(progress * CGFloat.pi * 2) * 16)
    )
    drawRainbowTrail(
        context: context,
        headCenter: center,
        size: size,
        progress: progress,
        opacity: opacity,
        motionMode: motionMode
    )
    drawUnicorn(
        context: context,
        center: center,
        scale: min(size.width, size.height) / 410,
        opacity: opacity
    )
}

private func drawWarningTapeBand(
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

private func drawWeight(
    context: GraphicsContext,
    center: CGPoint,
    radius: CGFloat,
    scale: CGFloat,
    opacity: Double
) {
    let weightContext = transformedContext(
        context: context,
        center: center,
        rotationDegrees: -4,
        scale: scale
    )

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

private func drawImpactLines(
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

private func drawBoulder(
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

private func drawDustCloud(
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

private func drawCheckMark(
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

private func drawBeam(
    context: GraphicsContext,
    center: CGPoint,
    length: CGFloat,
    width: CGFloat,
    rotationDegrees: CGFloat,
    color: Color,
    opacity: Double
) {
    let beamContext = transformedContext(
        context: context,
        center: center,
        rotationDegrees: rotationDegrees,
        scale: 1
    )
    var path = Path()
    path.addRoundedRect(
        in: CGRect(x: -width / 2, y: -length / 2, width: width, height: length),
        cornerSize: CGSize(width: width / 2, height: width / 2)
    )
    beamContext.fill(path, with: .color(color.opacity(opacity)))
}

private func drawPaperPlane(
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

private func drawCheckSeal(
    context: GraphicsContext,
    center: CGPoint,
    radius: CGFloat,
    scale: CGFloat,
    opacity: Double
) {
    let sealContext = transformedContext(
        context: context,
        center: center,
        rotationDegrees: -7,
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

private func drawSparkle(
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

private func drawCrown(
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

private func drawRainbowTrail(
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
        path.move(to: start)
        path.addCurve(
            to: CGPoint(x: start.x + trailLength, y: start.y + sin(progress * CGFloat.pi * 2 + CGFloat(index)) * 10),
            control1: CGPoint(x: start.x + trailLength * 0.35, y: start.y - 20),
            control2: CGPoint(x: start.x + trailLength * 0.70, y: start.y + 20)
        )
        context.stroke(
            path,
            with: .color(colors[index].opacity(opacity * 0.70)),
            style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
        )
    }
}

private func drawUnicorn(
    context: GraphicsContext,
    center: CGPoint,
    scale: CGFloat,
    opacity: Double
) {
    let unicornContext = transformedContext(
        context: context,
        center: center,
        rotationDegrees: -4,
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
    for x in legXs {
        var leg = Path()
        leg.move(to: CGPoint(x: x, y: 14))
        leg.addLine(to: CGPoint(x: x - 4, y: 44))
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
        var mane = Path()
        mane.move(to: CGPoint(x: 24 + CGFloat(index) * 10, y: -24))
        mane.addCurve(
            to: CGPoint(x: 10 + CGFloat(index) * 8, y: 6),
            control1: CGPoint(x: 12 + CGFloat(index) * 8, y: -20),
            control2: CGPoint(x: 28 + CGFloat(index) * 7, y: -2)
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

private func makeSpiralPath(
    center: CGPoint,
    maxRadius: CGFloat,
    startAngle: CGFloat,
    turns: CGFloat,
    progress: CGFloat
) -> Path {
    var path = Path()
    let steps = 76
    let boundedProgress = min(max(progress, 0), 1)
    for step in 0...steps {
        let fraction = CGFloat(step) / CGFloat(steps)
        guard fraction <= boundedProgress else {
            break
        }

        let radius = maxRadius * fraction
        let angle = startAngle + fraction * CGFloat.pi * 2 * turns
        let point = pointOnCircle(center: center, radius: radius, angle: angle)
        if step == 0 {
            path.move(to: point)
        } else {
            path.addLine(to: point)
        }
    }

    return path
}

private func makeScallopedSealPath(
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

private func makeRewindArrowPath(radius: CGFloat) -> Path {
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

private func drawTriangle(
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

private func transformedContext(
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

private func pointOnCircle(
    center: CGPoint,
    radius: CGFloat,
    angle: CGFloat
) -> CGPoint {
    CGPoint(
        x: center.x + cos(angle) * radius,
        y: center.y + sin(angle) * radius
    )
}

private func reviewReactionClampedProgress(progress: CGFloat) -> CGFloat {
    min(max(progress, 0), 1)
}

private func reviewReactionDrawingProgress(
    progress: CGFloat,
    motionMode: ReviewReactionMotionMode
) -> CGFloat {
    switch motionMode {
    case .standard:
        return reviewReactionClampedProgress(progress: progress)
    case .reduced:
        return reviewReactionReducedMotionDrawingProgress
    }
}

private func reviewReactionOpacity(progress: CGFloat) -> Double {
    let fadeIn = min(progress / 0.10, 1)
    let fadeOut = min((1 - progress) / 0.22, 1)
    return Double(max(0, min(fadeIn, fadeOut)))
}

private func reviewReactionEaseOutCubic(progress: CGFloat) -> CGFloat {
    let inverse = 1 - reviewReactionClampedProgress(progress: progress)
    return 1 - inverse * inverse * inverse
}

private func reviewReactionEaseInOut(progress: CGFloat) -> CGFloat {
    let boundedProgress = reviewReactionClampedProgress(progress: progress)
    return -(cos(CGFloat.pi * boundedProgress) - 1) / 2
}

private func reviewReactionInterpolate(
    start: CGFloat,
    end: CGFloat,
    progress: CGFloat
) -> CGFloat {
    start + (end - start) * progress
}

private func reviewReactionRedColor() -> Color {
    Color(red: 0.96, green: 0.13, blue: 0.17)
}

private func reviewReactionOrangeColor() -> Color {
    Color(red: 1.00, green: 0.50, blue: 0.10)
}

private func reviewReactionYellowColor() -> Color {
    Color(red: 1.00, green: 0.82, blue: 0.14)
}

private func reviewReactionGreenColor() -> Color {
    Color(red: 0.12, green: 0.76, blue: 0.34)
}

private func reviewReactionBlueColor() -> Color {
    Color(red: 0.16, green: 0.62, blue: 1.00)
}

private func reviewReactionPurpleColor() -> Color {
    Color(red: 0.58, green: 0.34, blue: 0.98)
}

private func reviewReactionPinkColor() -> Color {
    Color(red: 1.00, green: 0.32, blue: 0.68)
}
