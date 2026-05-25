package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.graphics.drawscope.DrawScope

internal fun DrawScope.drawReviewReaction(
    event: ReviewReactionEvent,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (event.variant) {
        ReviewReactionVariant.AGAIN_REWIND_VORTEX,
        ReviewReactionVariant.AGAIN_STAMP_FLYBY,
        ReviewReactionVariant.AGAIN_WARNING_TAPE -> drawAgainReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_HOURGLASS_SAND,
        ReviewReactionVariant.HARD_FALLING_WEIGHT,
        ReviewReactionVariant.HARD_YELLOW_CRACK,
        ReviewReactionVariant.HARD_ROLLING_BOULDER -> drawHardReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK,
        ReviewReactionVariant.GOOD_LIGHT_SWEEP,
        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK,
        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE -> drawGoodReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_SPARKLE_BURST,
        ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        ReviewReactionVariant.EASY_RAINBOW_STREAK,
        ReviewReactionVariant.EASY_CROWN_BOUNCE,
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> drawEasyReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )
    }
}
