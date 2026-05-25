package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.graphics.drawscope.DrawScope

internal fun DrawScope.drawReviewReaction(
    event: ReviewReactionEvent,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (event.variant) {
        ReviewReactionVariant.AGAIN_REWIND_VORTEX -> drawAgainReviewReaction(
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

        ReviewReactionVariant.EASY_SPARKLE_BURST,
        ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        ReviewReactionVariant.GOOD_OWL,
        ReviewReactionVariant.GOOD_POODLE,
        ReviewReactionVariant.GOOD_WHALE,
        ReviewReactionVariant.GOOD_PEACOCK,
        ReviewReactionVariant.EASY_RAINBOW_STREAK,
        ReviewReactionVariant.EASY_CROWN_BOUNCE,
        ReviewReactionVariant.EASY_UNICORN_FLYBY -> drawEasyReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )
    }
}
