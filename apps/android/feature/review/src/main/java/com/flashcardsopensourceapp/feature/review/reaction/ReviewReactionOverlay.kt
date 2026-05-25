package com.flashcardsopensourceapp.feature.review.reaction

import android.util.Log
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionResult
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.rememberLottieComposition
import com.flashcardsopensourceapp.feature.review.R
import kotlinx.coroutines.delay

private const val reviewReactionAnimationMinimumProgress: Float = 0f
private const val reviewReactionAnimationMaximumProgress: Float = 1f
private const val reviewReactionCleanupExtraMillis: Long = 80L
private const val reviewReactionLogTag: String = "ReviewReaction"
private const val reviewReactionReducedMotionDrawingProgress: Float = 0.55f
private const val reviewAgainWiltedFlowerAnimationFrameScale: Float = 0.56f
private const val reviewAgainWiltedFlowerAnimationCenterX: Float = 0.50f
private const val reviewAgainWiltedFlowerAnimationCenterY: Float = 0.50f
private const val reviewAgainWormAnimationFrameScale: Float = 0.58f
private const val reviewAgainWormAnimationCenterX: Float = 0.50f
private const val reviewAgainWormAnimationCenterY: Float = 0.52f
private const val reviewAgainSnailAnimationFrameScale: Float = 0.58f
private const val reviewAgainSnailAnimationCenterX: Float = 0.50f
private const val reviewAgainSnailAnimationCenterY: Float = 0.48f
private const val reviewEasyRainbowAnimationFrameScale: Float = 0.64f
private const val reviewEasyRainbowAnimationCenterX: Float = 0.50f
private const val reviewEasyRainbowAnimationCenterY: Float = 0.42f
private const val reviewEasyUnicornAnimationFrameScale: Float = 0.52f
private const val reviewEasyUnicornAnimationCenterX: Float = 0.56f
private const val reviewEasyUnicornAnimationCenterY: Float = 0.30f
private val reviewReactionLottieFallbackVariant: ReviewReactionVariant =
    ReviewReactionVariant.EASY_CROWN_BOUNCE

private data class ReviewReactionLottieConfiguration(
    val composition: LottieComposition?,
    val frameScale: Float,
    val centerX: Float,
    val centerY: Float
)

private fun logReviewReactionLottieWarning(
    assetName: String,
    error: Throwable
) {
    Log.w(
        reviewReactionLogTag,
        "Review reaction Lottie asset failed to load. assetName=$assetName",
        error
    )
}

private fun reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    reviewAgainWiltedFlowerComposition: LottieComposition?,
    reviewAgainWormComposition: LottieComposition?,
    reviewAgainSnailComposition: LottieComposition?,
    reviewEasyRainbowComposition: LottieComposition?,
    reviewEasyUnicornComposition: LottieComposition?
): ReviewReactionLottieConfiguration? {
    return when (variant) {
        ReviewReactionVariant.AGAIN_WILTED_FLOWER -> ReviewReactionLottieConfiguration(
            composition = reviewAgainWiltedFlowerComposition,
            frameScale = reviewAgainWiltedFlowerAnimationFrameScale,
            centerX = reviewAgainWiltedFlowerAnimationCenterX,
            centerY = reviewAgainWiltedFlowerAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_WORM_WIGGLE -> ReviewReactionLottieConfiguration(
            composition = reviewAgainWormComposition,
            frameScale = reviewAgainWormAnimationFrameScale,
            centerX = reviewAgainWormAnimationCenterX,
            centerY = reviewAgainWormAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_SNAIL_CRAWL -> ReviewReactionLottieConfiguration(
            composition = reviewAgainSnailComposition,
            frameScale = reviewAgainSnailAnimationFrameScale,
            centerX = reviewAgainSnailAnimationCenterX,
            centerY = reviewAgainSnailAnimationCenterY
        )

        ReviewReactionVariant.EASY_RAINBOW_STREAK -> ReviewReactionLottieConfiguration(
            composition = reviewEasyRainbowComposition,
            frameScale = reviewEasyRainbowAnimationFrameScale,
            centerX = reviewEasyRainbowAnimationCenterX,
            centerY = reviewEasyRainbowAnimationCenterY
        )

        ReviewReactionVariant.EASY_UNICORN_FLYBY -> ReviewReactionLottieConfiguration(
            composition = reviewEasyUnicornComposition,
            frameScale = reviewEasyUnicornAnimationFrameScale,
            centerX = reviewEasyUnicornAnimationCenterX,
            centerY = reviewEasyUnicornAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_REWIND_VORTEX,
        ReviewReactionVariant.HARD_HOURGLASS_SAND,
        ReviewReactionVariant.HARD_FALLING_WEIGHT,
        ReviewReactionVariant.HARD_YELLOW_CRACK,
        ReviewReactionVariant.HARD_ROLLING_BOULDER,
        ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK,
        ReviewReactionVariant.GOOD_LIGHT_SWEEP,
        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK,
        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE,
        ReviewReactionVariant.EASY_SPARKLE_BURST,
        ReviewReactionVariant.EASY_CROWN_BOUNCE -> null
    }
}

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    events: List<ReviewReactionEvent>,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    val reviewAgainWiltedFlowerCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_again_wilted_flower)
    )
    val reviewAgainWiltedFlowerCompositionFailure: Throwable? = reviewAgainWiltedFlowerCompositionResult.error
    if (reviewAgainWiltedFlowerCompositionFailure != null) {
        LaunchedEffect(reviewAgainWiltedFlowerCompositionFailure) {
            logReviewReactionLottieWarning(
                assetName = "review_again_wilted_flower",
                error = reviewAgainWiltedFlowerCompositionFailure
            )
        }
    }
    val reviewAgainWiltedFlowerComposition: LottieComposition? =
        if (reviewAgainWiltedFlowerCompositionFailure == null) {
            reviewAgainWiltedFlowerCompositionResult.value
        } else {
            null
        }

    val reviewAgainWormCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_again_worm)
    )
    val reviewAgainWormCompositionFailure: Throwable? = reviewAgainWormCompositionResult.error
    if (reviewAgainWormCompositionFailure != null) {
        LaunchedEffect(reviewAgainWormCompositionFailure) {
            logReviewReactionLottieWarning(
                assetName = "review_again_worm",
                error = reviewAgainWormCompositionFailure
            )
        }
    }
    val reviewAgainWormComposition: LottieComposition? = if (reviewAgainWormCompositionFailure == null) {
        reviewAgainWormCompositionResult.value
    } else {
        null
    }

    val reviewAgainSnailCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_again_snail)
    )
    val reviewAgainSnailCompositionFailure: Throwable? = reviewAgainSnailCompositionResult.error
    if (reviewAgainSnailCompositionFailure != null) {
        LaunchedEffect(reviewAgainSnailCompositionFailure) {
            logReviewReactionLottieWarning(
                assetName = "review_again_snail",
                error = reviewAgainSnailCompositionFailure
            )
        }
    }
    val reviewAgainSnailComposition: LottieComposition? = if (reviewAgainSnailCompositionFailure == null) {
        reviewAgainSnailCompositionResult.value
    } else {
        null
    }

    val reviewEasyRainbowCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_easy_rainbow)
    )
    val reviewEasyRainbowCompositionFailure: Throwable? = reviewEasyRainbowCompositionResult.error
    if (reviewEasyRainbowCompositionFailure != null) {
        LaunchedEffect(reviewEasyRainbowCompositionFailure) {
            logReviewReactionLottieWarning(
                assetName = "review_easy_rainbow",
                error = reviewEasyRainbowCompositionFailure
            )
        }
    }
    val reviewEasyRainbowComposition: LottieComposition? = if (reviewEasyRainbowCompositionFailure == null) {
        reviewEasyRainbowCompositionResult.value
    } else {
        null
    }

    val reviewEasyUnicornCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_easy_unicorn)
    )
    val reviewEasyUnicornCompositionFailure: Throwable? = reviewEasyUnicornCompositionResult.error
    if (reviewEasyUnicornCompositionFailure != null) {
        LaunchedEffect(reviewEasyUnicornCompositionFailure) {
            logReviewReactionLottieWarning(
                assetName = "review_easy_unicorn",
                error = reviewEasyUnicornCompositionFailure
            )
        }
    }
    val reviewEasyUnicornComposition: LottieComposition? = if (reviewEasyUnicornCompositionFailure == null) {
        reviewEasyUnicornCompositionResult.value
    } else {
        null
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
    ) {
        events.forEach { event: ReviewReactionEvent ->
            key(event.id) {
                ReviewReactionCanvas(
                    event = event,
                    motionMode = motionMode,
                    reviewAgainWiltedFlowerComposition = reviewAgainWiltedFlowerComposition,
                    reviewAgainWormComposition = reviewAgainWormComposition,
                    reviewAgainSnailComposition = reviewAgainSnailComposition,
                    reviewEasyRainbowComposition = reviewEasyRainbowComposition,
                    reviewEasyUnicornComposition = reviewEasyUnicornComposition,
                    onEventFinished = onEventFinished
                )
            }
        }
    }
}

@Composable
private fun ReviewReactionCanvas(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    reviewAgainWiltedFlowerComposition: LottieComposition?,
    reviewAgainWormComposition: LottieComposition?,
    reviewAgainSnailComposition: LottieComposition?,
    reviewEasyRainbowComposition: LottieComposition?,
    reviewEasyUnicornComposition: LottieComposition?,
    onEventFinished: (String) -> Unit
) {
    val lottieConfiguration: ReviewReactionLottieConfiguration? = remember(event.id, event.variant) {
        reviewReactionLottieConfiguration(
            variant = event.variant,
            reviewAgainWiltedFlowerComposition = reviewAgainWiltedFlowerComposition,
            reviewAgainWormComposition = reviewAgainWormComposition,
            reviewAgainSnailComposition = reviewAgainSnailComposition,
            reviewEasyRainbowComposition = reviewEasyRainbowComposition,
            reviewEasyUnicornComposition = reviewEasyUnicornComposition
        )
    }
    if (lottieConfiguration != null) {
        val composition: LottieComposition? = lottieConfiguration.composition
        if (composition != null) {
            ReviewReactionLottieAnimation(
                event = event,
                motionMode = motionMode,
                composition = composition,
                frameScale = lottieConfiguration.frameScale,
                centerX = lottieConfiguration.centerX,
                centerY = lottieConfiguration.centerY,
                onEventFinished = onEventFinished
            )
            return
        }
    }

    val drawingEvent: ReviewReactionEvent = if (lottieConfiguration != null) {
        event.copy(variant = reviewReactionLottieFallbackVariant)
    } else {
        event
    }
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = drawingEvent.variant,
        motionMode = motionMode
    )

    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        LaunchedEffect(event.id) {
            delay(timeMillis = durationMillis.toLong())
            onEventFinished(event.id)
        }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    this.alpha = 1f
                }
        ) {
            drawReviewReaction(
                event = drawingEvent,
                progress = reviewReactionReducedMotionDrawingProgress,
                motionMode = motionMode
            )
        }
        return
    }

    val progress: Animatable<Float, AnimationVector1D> = remember(event.id) {
        Animatable(initialValue = reviewReactionAnimationMinimumProgress)
    }

    LaunchedEffect(event.id) {
        progress.snapTo(targetValue = reviewReactionAnimationMinimumProgress)
        progress.animateTo(
            targetValue = reviewReactionAnimationMaximumProgress,
            animationSpec = tween(
                durationMillis = durationMillis,
                easing = LinearEasing
            )
        )
        delay(timeMillis = reviewReactionCleanupExtraMillis)
        onEventFinished(event.id)
    }

    val currentProgress: Float = progress.value
    val drawingProgress: Float = reviewReactionClampedProgress(progress = currentProgress)
    val alpha: Float = reviewReactionOpacity(progress = currentProgress)

    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
            }
    ) {
        drawReviewReaction(
            event = drawingEvent,
            progress = drawingProgress,
            motionMode = motionMode
        )
    }
}

@Composable
private fun ReviewReactionLottieAnimation(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    composition: LottieComposition,
    frameScale: Float,
    centerX: Float,
    centerY: Float,
    onEventFinished: (String) -> Unit
) {
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = event.variant,
        motionMode = motionMode
    )

    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        LaunchedEffect(event.id, composition) {
            delay(timeMillis = durationMillis.toLong())
            onEventFinished(event.id)
        }

        ReviewReactionLottieFrame(
            progress = reviewReactionReducedMotionDrawingProgress,
            alpha = 1f,
            frameScale = frameScale,
            centerX = centerX,
            centerY = centerY,
            composition = composition
        )
        return
    }

    val progress: Animatable<Float, AnimationVector1D> = remember(event.id, composition) {
        Animatable(initialValue = reviewReactionAnimationMinimumProgress)
    }

    LaunchedEffect(event.id, composition) {
        progress.snapTo(targetValue = reviewReactionAnimationMinimumProgress)
        progress.animateTo(
            targetValue = reviewReactionAnimationMaximumProgress,
            animationSpec = tween(
                durationMillis = durationMillis,
                easing = LinearEasing
            )
        )
        delay(timeMillis = reviewReactionCleanupExtraMillis)
        onEventFinished(event.id)
    }

    val currentProgress: Float = progress.value
    val drawingProgress: Float = reviewReactionClampedProgress(progress = currentProgress)
    val alpha: Float = reviewReactionOpacity(progress = currentProgress)

    ReviewReactionLottieFrame(
        progress = drawingProgress,
        alpha = alpha,
        frameScale = frameScale,
        centerX = centerX,
        centerY = centerY,
        composition = composition
    )
}

@Composable
private fun ReviewReactionLottieFrame(
    progress: Float,
    alpha: Float,
    frameScale: Float,
    centerX: Float,
    centerY: Float,
    composition: LottieComposition
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
            }
    ) {
        val sideLength: Dp = minOf(maxWidth, maxHeight) * frameScale
        LottieAnimation(
            composition = composition,
            progress = { progress },
            modifier = Modifier
                .size(size = sideLength)
                .offset(
                    x = maxWidth * centerX - sideLength / 2f,
                    y = maxHeight * centerY - sideLength / 2f
                )
                .align(alignment = Alignment.TopStart)
        )
    }
}
