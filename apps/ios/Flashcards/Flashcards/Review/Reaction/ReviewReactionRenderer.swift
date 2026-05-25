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
        case .fallbackCrownBounce:
            drawEasyCrownBounce(
                context: drawingContext,
                size: drawableSize,
                progress: drawingProgress,
                motionMode: motionMode
            )
        case .againWiltedFlower,
             .againWormWiggle,
             .againTornado,
             .againSnailCrawl,
             .goodOwl,
             .goodPoodle,
             .goodWhale,
             .goodPeacock,
             .hardOxCharge,
             .hardPawPrints,
             .hardRacehorseGallop,
             .hardVolcanoEruption,
             .easyRoseBloom,
             .easyRainbowStreak,
             .easyPhoenixRise,
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
