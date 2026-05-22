package com.flashcardsopensourceapp.feature.review

import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

internal data class ReviewReactionPhaseProgress(
    val enter: Float,
    val hold: Float,
    val exit: Float
)

internal fun reviewReactionOpacity(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress < 0.12f) {
        return reviewReactionClampedProgress(progress = clampedProgress / 0.12f)
    }
    if (clampedProgress > 0.88f) {
        return reviewReactionClampedProgress(progress = (1f - clampedProgress) / 0.12f)
    }
    return 1f
}

internal fun reviewReactionPhaseProgress(
    progress: Float,
    enterEnd: Float,
    exitStart: Float
): ReviewReactionPhaseProgress {
    require(enterEnd > 0f) {
        "Review reaction enter phase must be positive."
    }
    require(exitStart > enterEnd) {
        "Review reaction exit phase must start after enter phase."
    }
    require(exitStart < 1f) {
        "Review reaction exit phase must start before progress completes."
    }

    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    return ReviewReactionPhaseProgress(
        enter = reviewReactionClampedProgress(progress = clampedProgress / enterEnd),
        hold = reviewReactionClampedProgress(progress = (clampedProgress - enterEnd) / (exitStart - enterEnd)),
        exit = reviewReactionClampedProgress(progress = (clampedProgress - exitStart) / (1f - exitStart))
    )
}

internal fun reviewReactionPopScale(
    progress: Float,
    enterEnd: Float,
    exitStart: Float,
    baseScale: Float,
    peakScale: Float,
    settledScale: Float
): Float {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = enterEnd,
        exitStart = exitStart
    )
    if (phase.enter < 1f) {
        val scale: Float = reviewReactionInterpolate(
            start = baseScale,
            end = peakScale,
            progress = reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.22f)
        )
        return min(scale, peakScale)
    }
    if (phase.exit > 0f) {
        return reviewReactionInterpolate(
            start = settledScale,
            end = baseScale,
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }

    val settlePulse: Float = sin(phase.hold * PI.toFloat() * 4f) * 0.045f * (1f - phase.hold)
    return settledScale + settlePulse
}

internal fun reviewReactionClampedProgress(progress: Float): Float {
    return min(max(progress, 0f), 1f)
}

internal fun reviewReactionInterpolate(
    start: Float,
    end: Float,
    progress: Float
): Float {
    return start + (end - start) * reviewReactionClampedProgress(progress = progress)
}

internal fun reviewReactionEaseOutCubic(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    val inverseProgress: Float = 1f - clampedProgress
    return 1f - inverseProgress * inverseProgress * inverseProgress
}

internal fun reviewReactionEaseInCubic(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    return clampedProgress * clampedProgress * clampedProgress
}

internal fun reviewReactionEaseInOut(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress < 0.5f) {
        return 4f * clampedProgress * clampedProgress * clampedProgress
    }

    val shiftedProgress: Float = -2f * clampedProgress + 2f
    return 1f - shiftedProgress * shiftedProgress * shiftedProgress / 2f
}

internal fun reviewReactionEaseOutBack(
    progress: Float,
    overshoot: Float
): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    val shiftedProgress: Float = clampedProgress - 1f
    return 1f + (overshoot + 1f) * shiftedProgress * shiftedProgress * shiftedProgress +
        overshoot * shiftedProgress * shiftedProgress
}
