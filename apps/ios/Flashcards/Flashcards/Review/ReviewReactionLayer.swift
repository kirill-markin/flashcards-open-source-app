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
        case .goodHandDrawnCheck:
            return 1.15
        case .againRedScribbleSlash, .hardYellowCrack:
            return 1.20
        case .easySparkleBurst:
            return 1.25
        case .againRewindVortex, .goodLightSweep, .goodCheckSealBounce:
            return 1.45
        case .hardHourglassSand, .againWarningTape, .easyRainbowStreak:
            return 1.55
        case .hardFallingWeight, .easyCrownBounce:
            return 1.65
        case .goodPaperPlaneCheck:
            return 1.75
        case .againStampFlyby:
            return 1.90
        case .hardRollingBoulder:
            return 2.05
        case .easyUnicornFlyby:
            return 2.15
        }
    }

    var cleanupDelayNanoseconds: UInt64 {
        let cleanupDelaySeconds = self.animationDurationSeconds + 0.08
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

private struct ReviewReactionPhaseProgress {
    let enter: CGFloat
    let hold: CGFloat
    let exit: CGFloat
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

    let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.70, exitStart: 0.82)
    let width = size.width
    let height = size.height
    let startX = width * 0.16
    let endX = width * 0.84
    let startY = motionMode == .reduced ? height * 0.30 : height * 0.20
    let endY = motionMode == .reduced ? height * 0.63 : height * 0.78
    let offsets: [CGFloat] = [-12, 7, 19]

    for (index, offset) in offsets.enumerated() {
        let stagger = CGFloat(index) * 0.12
        let drawProgress = motionMode == .reduced
            ? 1
            : reviewReactionClampedProgress(progress: (phase.enter - stagger) / 0.72)
        let shake = motionMode == .reduced
            ? 0
            : sin(progress * CGFloat.pi * 16 + CGFloat(index) * 1.7) * 4 * (1 - phase.exit)
        var path = Path()
        path.move(to: CGPoint(x: startX, y: startY + offset + shake))
        path.addCurve(
            to: CGPoint(x: endX, y: endY + offset * 0.35 - shake * 0.6),
            control1: CGPoint(x: width * 0.28, y: height * 0.26 + offset * 0.6 - shake),
            control2: CGPoint(x: width * 0.64, y: height * 0.70 - offset * 0.4 + shake)
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

    let phase = reviewReactionPhaseProgress(progress: progress, enterEnd: 0.42, exitStart: 0.80)
    let displayCenter = CGPoint(x: size.width * 0.62, y: size.height * 0.28)
    let center: CGPoint
    if motionMode == .reduced {
        center = CGPoint(x: size.width * 0.50, y: size.height * 0.28)
    } else if progress < 0.42 {
        center = cubicBezierPoint(
            start: CGPoint(x: size.width * 1.18, y: size.height * 0.22),
            control1: CGPoint(x: size.width * 0.98, y: size.height * 0.08),
            control2: CGPoint(x: size.width * 0.74, y: size.height * 0.36),
            end: displayCenter,
            progress: reviewReactionEaseOutCubic(progress: phase.enter)
        )
    } else if progress < 0.80 {
        center = CGPoint(
            x: displayCenter.x + sin(phase.hold * CGFloat.pi * 2) * 20,
            y: displayCenter.y + sin(phase.hold * CGFloat.pi * 4) * 14
        )
    } else {
        center = cubicBezierPoint(
            start: displayCenter,
            control1: CGPoint(x: size.width * 0.40, y: size.height * 0.16),
            control2: CGPoint(x: size.width * 0.12, y: size.height * 0.34),
            end: CGPoint(x: size.width * -0.22, y: size.height * 0.24),
            progress: reviewReactionEaseInCubic(progress: phase.exit)
        )
    }
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
        scale: min(size.width, size.height) / 410 * (motionMode == .reduced ? 1 : 0.84 + reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.18) * 0.20 - phase.exit * 0.12),
        progress: progress,
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

private func drawUnicorn(
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

private func cubicBezierPoint(
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

private func reviewReactionPhaseProgress(
    progress: CGFloat,
    enterEnd: CGFloat,
    exitStart: CGFloat
) -> ReviewReactionPhaseProgress {
    precondition(enterEnd > 0, "Review reaction enter phase must be positive.")
    precondition(exitStart > enterEnd, "Review reaction exit phase must start after enter phase.")
    precondition(exitStart < 1, "Review reaction exit phase must start before progress completes.")

    let boundedProgress = reviewReactionClampedProgress(progress: progress)
    return ReviewReactionPhaseProgress(
        enter: reviewReactionClampedProgress(progress: boundedProgress / enterEnd),
        hold: reviewReactionClampedProgress(progress: (boundedProgress - enterEnd) / (exitStart - enterEnd)),
        exit: reviewReactionClampedProgress(progress: (boundedProgress - exitStart) / (1 - exitStart))
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

private func reviewReactionEaseInCubic(progress: CGFloat) -> CGFloat {
    let boundedProgress = reviewReactionClampedProgress(progress: progress)
    return boundedProgress * boundedProgress * boundedProgress
}

private func reviewReactionEaseInOut(progress: CGFloat) -> CGFloat {
    let boundedProgress = reviewReactionClampedProgress(progress: progress)
    return -(cos(CGFloat.pi * boundedProgress) - 1) / 2
}

private func reviewReactionEaseOutBack(progress: CGFloat, overshoot: CGFloat) -> CGFloat {
    let boundedProgress = reviewReactionClampedProgress(progress: progress)
    let shiftedProgress = boundedProgress - 1
    return 1 + (overshoot + 1) * shiftedProgress * shiftedProgress * shiftedProgress + overshoot * shiftedProgress * shiftedProgress
}

private func reviewReactionPopScale(
    progress: CGFloat,
    enterEnd: CGFloat,
    exitStart: CGFloat,
    baseScale: CGFloat,
    peakScale: CGFloat,
    settledScale: CGFloat
) -> CGFloat {
    let phase = reviewReactionPhaseProgress(
        progress: progress,
        enterEnd: enterEnd,
        exitStart: exitStart
    )
    if phase.enter < 1 {
        let scale = reviewReactionInterpolate(
            start: baseScale,
            end: settledScale,
            progress: reviewReactionEaseOutBack(progress: phase.enter, overshoot: 1.22)
        )
        return min(scale, peakScale)
    }
    if phase.exit > 0 {
        return reviewReactionInterpolate(
            start: settledScale,
            end: settledScale * 0.82,
            progress: reviewReactionEaseInCubic(progress: phase.exit)
        )
    }

    let settlePulse = sin(phase.hold * CGFloat.pi * 4) * 0.045 * (1 - phase.hold)
    return settledScale + settlePulse
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
