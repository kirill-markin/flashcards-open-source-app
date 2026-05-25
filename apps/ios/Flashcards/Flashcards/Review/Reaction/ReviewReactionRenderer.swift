import SwiftUI

enum ReviewReactionRenderer {
    static func draw(
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
        case .againRewindVortex:
            drawAgainRewindVortex(
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
        case .easySparkleBurst:
            drawEasySparkleBurst(
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
        case .againWormWiggle,
             .againSnailCrawl,
             .goodOwl,
             .goodPoodle,
             .goodWhale,
             .goodPeacock,
             .easyRainbowStreak,
             .easyUnicornFlyby:
            drawEasyCrownBounce(
                context: drawingContext,
                size: drawableSize,
                progress: drawingProgress,
                motionMode: motionMode
            )
        }
    }
}
