package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.graphics.drawscope.DrawScope

internal fun DrawScope.drawReviewReaction(
    event: ReviewReactionEvent,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (event.variant) {
        ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        ReviewReactionVariant.AGAIN_TORNADO,
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        ReviewReactionVariant.GOOD_OWL,
        ReviewReactionVariant.GOOD_POODLE,
        ReviewReactionVariant.GOOD_WHALE,
        ReviewReactionVariant.GOOD_PEACOCK,
        ReviewReactionVariant.HARD_OX_CHARGE,
        ReviewReactionVariant.HARD_PAW_PRINTS,
        ReviewReactionVariant.HARD_RACEHORSE_GALLOP,
        ReviewReactionVariant.HARD_VOLCANO_ERUPTION,
        ReviewReactionVariant.EASY_ROSE_BLOOM,
        ReviewReactionVariant.EASY_RAINBOW_STREAK,
        ReviewReactionVariant.EASY_PHOENIX_RISE,
        ReviewReactionVariant.EASY_UNICORN_FLYBY,
        ReviewReactionVariant.FALLBACK_CROWN_BOUNCE -> drawEasyReviewReaction(
            variant = event.variant,
            progress = progress,
            motionMode = motionMode
        )
    }
}
