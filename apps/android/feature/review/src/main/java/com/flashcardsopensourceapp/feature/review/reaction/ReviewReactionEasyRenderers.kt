package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawEasyReviewReaction(
    variant: ReviewReactionVariant,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (variant) {
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
        ReviewReactionVariant.FALLBACK_CROWN_BOUNCE -> drawEasyCrownBounce(
            progress = progress,
            motionMode = motionMode
        )
    }
}

private fun DrawScope.drawEasyCrownBounce(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.44f,
        exitStart = 0.82f
    )
    val targetCenter: Offset = Offset(
        x = size.width * reviewReactionCenterX,
        y = size.height * reviewReactionCenterY
    )
    val bounce: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        sin(progress * PI.toFloat())
    } else {
        sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
    }
    val center: Offset = targetCenter
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionPopScale(
            progress = progress,
            enterEnd = 0.44f,
            exitStart = 0.82f,
            baseScale = 0.76f,
            peakScale = 1.16f,
            settledScale = 1.00f
        )
    }
    val scale: Float = min(size.width, size.height) / 360f * scaleMultiplier
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -3f
    } else {
        -14f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 18f + bounce * 4f
    }
    drawCrown(center = center, scale = scale, rotationDegrees = rotationDegrees)
    drawSparkle(
        center = Offset(x = center.x + 76f * scale + phase.hold * 16f, y = center.y - 48f * scale - abs(bounce) * 10f),
        radius = 14f * scale * (0.80f + sin(progress * PI.toFloat() * 5f) * 0.18f + phase.enter * 0.20f),
        color = reviewReactionYellowColor
    )
}
