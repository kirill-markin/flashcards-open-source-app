package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.graphics.drawscope.DrawScope

internal fun DrawScope.drawReviewReaction(
    event: ReviewReactionEvent,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (event.variant) {
        ReviewReactionVariant.AGAIN_RAIN_CLOUD,
        ReviewReactionVariant.AGAIN_TORNADO,
        ReviewReactionVariant.AGAIN_WIND_FACE,
        ReviewReactionVariant.AGAIN_SNOWFLAKE,
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        ReviewReactionVariant.AGAIN_TURTLE,
        ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        ReviewReactionVariant.AGAIN_SPIDER,
        ReviewReactionVariant.AGAIN_RAT,
        ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        ReviewReactionVariant.HARD_TIGER,
        ReviewReactionVariant.HARD_T_REX,
        ReviewReactionVariant.HARD_SHARK,
        ReviewReactionVariant.HARD_OX_CHARGE,
        ReviewReactionVariant.HARD_RACEHORSE_GALLOP,
        ReviewReactionVariant.HARD_SNAKE,
        ReviewReactionVariant.HARD_VOLCANO_ERUPTION,
        ReviewReactionVariant.HARD_SCORPION,
        ReviewReactionVariant.HARD_PAW_PRINTS,
        ReviewReactionVariant.HARD_ROOSTER,
        ReviewReactionVariant.GOOD_OTTER,
        ReviewReactionVariant.GOOD_OWL,
        ReviewReactionVariant.GOOD_RABBIT,
        ReviewReactionVariant.GOOD_SEAL,
        ReviewReactionVariant.GOOD_SERVICE_DOG,
        ReviewReactionVariant.GOOD_POODLE,
        ReviewReactionVariant.GOOD_CHIMPANZEE,
        ReviewReactionVariant.GOOD_WHALE,
        ReviewReactionVariant.GOOD_PEACOCK,
        ReviewReactionVariant.GOOD_PIG,
        ReviewReactionVariant.EASY_SUNRISE,
        ReviewReactionVariant.EASY_SUNRISE_OVER_MOUNTAINS,
        ReviewReactionVariant.EASY_ROSE_BLOOM,
        ReviewReactionVariant.EASY_PEACE,
        ReviewReactionVariant.EASY_PLANT,
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
