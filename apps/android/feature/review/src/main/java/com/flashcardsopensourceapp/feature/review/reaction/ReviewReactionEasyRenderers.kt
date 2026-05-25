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
        ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        ReviewReactionVariant.AGAIN_TORNADO,
        ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        ReviewReactionVariant.GOOD_OWL,
        ReviewReactionVariant.GOOD_POODLE,
        ReviewReactionVariant.GOOD_WHALE,
        ReviewReactionVariant.GOOD_PEACOCK,
        ReviewReactionVariant.EASY_ROSE_BLOOM,
        ReviewReactionVariant.EASY_RAINBOW_STREAK,
        ReviewReactionVariant.EASY_PHOENIX_RISE,
        ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        ReviewReactionVariant.EASY_UNICORN_FLYBY,
        ReviewReactionVariant.FALLBACK_CROWN_BOUNCE -> drawEasyCrownBounce(
            progress = progress,
            motionMode = motionMode
        )

        else -> error("Unsupported easy review reaction variant: $variant")
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
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.40f)
    val bounce: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        sin(progress * PI.toFloat())
    } else {
        sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
    }
    val centerWaveX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 6f * (1f - phase.exit)
    }
    val centerY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter.y
    } else {
        reviewReactionInterpolate(
            start = -min(size.width, size.height) * 0.16f,
            end = targetCenter.y,
            progress = reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.10f)
        ) - bounce * 28f + phase.exit * 18f
    }
    val center: Offset = Offset(
        x = targetCenter.x + centerWaveX,
        y = centerY
    )
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
