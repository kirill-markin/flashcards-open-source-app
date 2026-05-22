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
}
