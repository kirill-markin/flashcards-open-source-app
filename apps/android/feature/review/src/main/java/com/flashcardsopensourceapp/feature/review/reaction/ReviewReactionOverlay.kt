package com.flashcardsopensourceapp.feature.review.reaction

import android.util.Log
import androidx.annotation.RawRes
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
private const val reviewAgainTornadoAnimationFrameScale: Float = 0.58f
private const val reviewAgainTornadoAnimationCenterX: Float = 0.50f
private const val reviewAgainTornadoAnimationCenterY: Float = 0.45f
private const val reviewAgainSnailAnimationFrameScale: Float = 0.58f
private const val reviewAgainSnailAnimationCenterX: Float = 0.50f
private const val reviewAgainSnailAnimationCenterY: Float = 0.48f
private const val reviewGoodOwlAnimationFrameScale: Float = 0.56f
private const val reviewGoodOwlAnimationCenterX: Float = 0.50f
private const val reviewGoodOwlAnimationCenterY: Float = 0.42f
private const val reviewGoodPoodleAnimationFrameScale: Float = 0.56f
private const val reviewGoodPoodleAnimationCenterX: Float = 0.50f
private const val reviewGoodPoodleAnimationCenterY: Float = 0.43f
private const val reviewGoodWhaleAnimationFrameScale: Float = 0.58f
private const val reviewGoodWhaleAnimationCenterX: Float = 0.50f
private const val reviewGoodWhaleAnimationCenterY: Float = 0.42f
private const val reviewGoodPeacockAnimationFrameScale: Float = 0.58f
private const val reviewGoodPeacockAnimationCenterX: Float = 0.50f
private const val reviewGoodPeacockAnimationCenterY: Float = 0.42f
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

private data class ReviewReactionLottieCompositionStore(
    val reviewAgainWiltedFlowerComposition: LottieComposition?,
    val reviewAgainWormComposition: LottieComposition?,
    val reviewAgainTornadoComposition: LottieComposition?,
    val reviewAgainSnailComposition: LottieComposition?,
    val reviewGoodOwlComposition: LottieComposition?,
    val reviewGoodPoodleComposition: LottieComposition?,
    val reviewGoodWhaleComposition: LottieComposition?,
    val reviewGoodPeacockComposition: LottieComposition?,
    val reviewEasyRainbowComposition: LottieComposition?,
    val reviewEasyUnicornComposition: LottieComposition?
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

@Composable
private fun rememberReviewReactionLottieComposition(
    @RawRes rawResourceId: Int,
    assetName: String
): LottieComposition? {
    val compositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(rawResourceId)
    )
    val compositionFailure: Throwable? = compositionResult.error
    if (compositionFailure != null) {
        LaunchedEffect(compositionFailure) {
            logReviewReactionLottieWarning(
                assetName = assetName,
                error = compositionFailure
            )
        }
    }

    return if (compositionFailure == null) {
        compositionResult.value
    } else {
        null
    }
}

private fun reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    compositionStore: ReviewReactionLottieCompositionStore
): ReviewReactionLottieConfiguration? {
    return when (variant) {
        ReviewReactionVariant.AGAIN_WILTED_FLOWER -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewAgainWiltedFlowerComposition,
            frameScale = reviewAgainWiltedFlowerAnimationFrameScale,
            centerX = reviewAgainWiltedFlowerAnimationCenterX,
            centerY = reviewAgainWiltedFlowerAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_WORM_WIGGLE -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewAgainWormComposition,
            frameScale = reviewAgainWormAnimationFrameScale,
            centerX = reviewAgainWormAnimationCenterX,
            centerY = reviewAgainWormAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_TORNADO -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewAgainTornadoComposition,
            frameScale = reviewAgainTornadoAnimationFrameScale,
            centerX = reviewAgainTornadoAnimationCenterX,
            centerY = reviewAgainTornadoAnimationCenterY
        )

        ReviewReactionVariant.AGAIN_SNAIL_CRAWL -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewAgainSnailComposition,
            frameScale = reviewAgainSnailAnimationFrameScale,
            centerX = reviewAgainSnailAnimationCenterX,
            centerY = reviewAgainSnailAnimationCenterY
        )

        ReviewReactionVariant.GOOD_OWL -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewGoodOwlComposition,
            frameScale = reviewGoodOwlAnimationFrameScale,
            centerX = reviewGoodOwlAnimationCenterX,
            centerY = reviewGoodOwlAnimationCenterY
        )

        ReviewReactionVariant.GOOD_POODLE -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewGoodPoodleComposition,
            frameScale = reviewGoodPoodleAnimationFrameScale,
            centerX = reviewGoodPoodleAnimationCenterX,
            centerY = reviewGoodPoodleAnimationCenterY
        )

        ReviewReactionVariant.GOOD_WHALE -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewGoodWhaleComposition,
            frameScale = reviewGoodWhaleAnimationFrameScale,
            centerX = reviewGoodWhaleAnimationCenterX,
            centerY = reviewGoodWhaleAnimationCenterY
        )

        ReviewReactionVariant.GOOD_PEACOCK -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewGoodPeacockComposition,
            frameScale = reviewGoodPeacockAnimationFrameScale,
            centerX = reviewGoodPeacockAnimationCenterX,
            centerY = reviewGoodPeacockAnimationCenterY
        )

        ReviewReactionVariant.EASY_RAINBOW_STREAK -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewEasyRainbowComposition,
            frameScale = reviewEasyRainbowAnimationFrameScale,
            centerX = reviewEasyRainbowAnimationCenterX,
            centerY = reviewEasyRainbowAnimationCenterY
        )

        ReviewReactionVariant.EASY_UNICORN_FLYBY -> ReviewReactionLottieConfiguration(
            composition = compositionStore.reviewEasyUnicornComposition,
            frameScale = reviewEasyUnicornAnimationFrameScale,
            centerX = reviewEasyUnicornAnimationCenterX,
            centerY = reviewEasyUnicornAnimationCenterY
        )

        ReviewReactionVariant.HARD_HOURGLASS_SAND,
        ReviewReactionVariant.HARD_FALLING_WEIGHT,
        ReviewReactionVariant.HARD_YELLOW_CRACK,
        ReviewReactionVariant.HARD_ROLLING_BOULDER,
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
    val compositionStore: ReviewReactionLottieCompositionStore = ReviewReactionLottieCompositionStore(
        reviewAgainWiltedFlowerComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_again_wilted_flower,
            assetName = "review_again_wilted_flower"
        ),
        reviewAgainWormComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_again_worm,
            assetName = "review_again_worm"
        ),
        reviewAgainTornadoComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_again_tornado,
            assetName = "review_again_tornado"
        ),
        reviewAgainSnailComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_again_snail,
            assetName = "review_again_snail"
        ),
        reviewGoodOwlComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_good_owl,
            assetName = "review_good_owl"
        ),
        reviewGoodPoodleComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_good_poodle,
            assetName = "review_good_poodle"
        ),
        reviewGoodWhaleComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_good_whale,
            assetName = "review_good_whale"
        ),
        reviewGoodPeacockComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_good_peacock,
            assetName = "review_good_peacock"
        ),
        reviewEasyRainbowComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_easy_rainbow,
            assetName = "review_easy_rainbow"
        ),
        reviewEasyUnicornComposition = rememberReviewReactionLottieComposition(
            rawResourceId = R.raw.review_easy_unicorn,
            assetName = "review_easy_unicorn"
        )
    )

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
                    compositionStore = compositionStore,
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
    compositionStore: ReviewReactionLottieCompositionStore,
    onEventFinished: (String) -> Unit
) {
    val initialLottieConfiguration: ReviewReactionLottieConfiguration? = remember(event.id, event.variant) {
        reviewReactionLottieConfiguration(
            variant = event.variant,
            compositionStore = compositionStore
        )
    }
    if (initialLottieConfiguration != null) {
        val composition: LottieComposition? = initialLottieConfiguration.composition
        if (composition != null) {
            ReviewReactionLottieAnimation(
                event = event,
                motionMode = motionMode,
                composition = composition,
                frameScale = initialLottieConfiguration.frameScale,
                centerX = initialLottieConfiguration.centerX,
                centerY = initialLottieConfiguration.centerY,
                onEventFinished = onEventFinished
            )
            return
        }
    }

    val drawingEvent: ReviewReactionEvent = if (initialLottieConfiguration != null) {
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
