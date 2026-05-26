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
private val reviewReactionLottieFallbackVariant: ReviewReactionVariant =
    ReviewReactionVariant.FALLBACK_CROWN_BOUNCE

private data class ReviewReactionLottieAssetConfiguration(
    val variant: ReviewReactionVariant,
    @RawRes val rawResourceId: Int,
    val assetName: String,
    val frameScale: Float,
    val centerX: Float,
    val centerY: Float
)

private data class ReviewReactionLottieConfiguration(
    val composition: LottieComposition?,
    val frameScale: Float,
    val centerX: Float,
    val centerY: Float
)

private typealias ReviewReactionLottieCompositionStore = Map<ReviewReactionVariant, LottieComposition?>

private val reviewReactionLottieAssetConfigurations: List<ReviewReactionLottieAssetConfiguration> = listOf(
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_RAIN_CLOUD,
        rawResourceId = R.raw.review_again_rain_cloud,
        assetName = "review_again_rain_cloud",
        frameScale = 0.62f,
        centerX = 0.50f,
        centerY = 0.44f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_TORNADO,
        rawResourceId = R.raw.review_again_tornado,
        assetName = "review_again_tornado",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.45f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WIND_FACE,
        rawResourceId = R.raw.review_again_wind_face,
        assetName = "review_again_wind_face",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.45f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SNOWFLAKE,
        rawResourceId = R.raw.review_again_snowflake,
        assetName = "review_again_snowflake",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.45f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        rawResourceId = R.raw.review_again_snail,
        assetName = "review_again_snail",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_TURTLE,
        rawResourceId = R.raw.review_again_turtle,
        assetName = "review_again_turtle",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        rawResourceId = R.raw.review_again_wilted_flower,
        assetName = "review_again_wilted_flower",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SPIDER,
        rawResourceId = R.raw.review_again_spider,
        assetName = "review_again_spider",
        frameScale = 0.54f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_RAT,
        rawResourceId = R.raw.review_again_rat,
        assetName = "review_again_rat",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        rawResourceId = R.raw.review_again_worm,
        assetName = "review_again_worm",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.52f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_TIGER,
        rawResourceId = R.raw.review_hard_tiger,
        assetName = "review_hard_tiger",
        frameScale = 0.62f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_T_REX,
        rawResourceId = R.raw.review_hard_t_rex,
        assetName = "review_hard_t_rex",
        frameScale = 0.62f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SHARK,
        rawResourceId = R.raw.review_hard_shark,
        assetName = "review_hard_shark",
        frameScale = 0.62f,
        centerX = 0.50f,
        centerY = 0.47f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_OX_CHARGE,
        rawResourceId = R.raw.review_hard_ox,
        assetName = "review_hard_ox",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_RACEHORSE_GALLOP,
        rawResourceId = R.raw.review_hard_racehorse,
        assetName = "review_hard_racehorse",
        frameScale = 0.62f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SNAKE,
        rawResourceId = R.raw.review_hard_snake,
        assetName = "review_hard_snake",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_VOLCANO_ERUPTION,
        rawResourceId = R.raw.review_hard_volcano,
        assetName = "review_hard_volcano",
        frameScale = 0.64f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SCORPION,
        rawResourceId = R.raw.review_hard_scorpion,
        assetName = "review_hard_scorpion",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_PAW_PRINTS,
        rawResourceId = R.raw.review_hard_paw_prints,
        assetName = "review_hard_paw_prints",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_ROOSTER,
        rawResourceId = R.raw.review_hard_rooster,
        assetName = "review_hard_rooster",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_OTTER,
        rawResourceId = R.raw.review_good_otter,
        assetName = "review_good_otter",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_OWL,
        rawResourceId = R.raw.review_good_owl,
        assetName = "review_good_owl",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_RABBIT,
        rawResourceId = R.raw.review_good_rabbit,
        assetName = "review_good_rabbit",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.47f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_SEAL,
        rawResourceId = R.raw.review_good_seal,
        assetName = "review_good_seal",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.47f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_SERVICE_DOG,
        rawResourceId = R.raw.review_good_service_dog,
        assetName = "review_good_service_dog",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.47f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_POODLE,
        rawResourceId = R.raw.review_good_poodle,
        assetName = "review_good_poodle",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.43f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_CHIMPANZEE,
        rawResourceId = R.raw.review_good_chimpanzee,
        assetName = "review_good_chimpanzee",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.46f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_WHALE,
        rawResourceId = R.raw.review_good_whale,
        assetName = "review_good_whale",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_PEACOCK,
        rawResourceId = R.raw.review_good_peacock,
        assetName = "review_good_peacock",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_PIG,
        rawResourceId = R.raw.review_good_pig,
        assetName = "review_good_pig",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_SUNRISE,
        rawResourceId = R.raw.review_easy_sunrise,
        assetName = "review_easy_sunrise",
        frameScale = 0.64f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_SUNRISE_OVER_MOUNTAINS,
        rawResourceId = R.raw.review_easy_sunrise_over_mountains,
        assetName = "review_easy_sunrise_over_mountains",
        frameScale = 0.64f,
        centerX = 0.50f,
        centerY = 0.44f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_ROSE_BLOOM,
        rawResourceId = R.raw.review_easy_rose,
        assetName = "review_easy_rose",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PEACE,
        rawResourceId = R.raw.review_easy_peace,
        assetName = "review_easy_peace",
        frameScale = 0.56f,
        centerX = 0.50f,
        centerY = 0.48f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PLANT,
        rawResourceId = R.raw.review_easy_plant,
        assetName = "review_easy_plant",
        frameScale = 0.58f,
        centerX = 0.50f,
        centerY = 0.50f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_RAINBOW_STREAK,
        rawResourceId = R.raw.review_easy_rainbow,
        assetName = "review_easy_rainbow",
        frameScale = 0.64f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PHOENIX_RISE,
        rawResourceId = R.raw.review_easy_phoenix,
        assetName = "review_easy_phoenix",
        frameScale = 0.64f,
        centerX = 0.50f,
        centerY = 0.42f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_UNICORN_FLYBY,
        rawResourceId = R.raw.review_easy_unicorn,
        assetName = "review_easy_unicorn",
        frameScale = 0.52f,
        centerX = 0.56f,
        centerY = 0.30f
    )
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
    val assetConfiguration: ReviewReactionLottieAssetConfiguration = reviewReactionLottieAssetConfigurations
        .firstOrNull { configuration: ReviewReactionLottieAssetConfiguration ->
            configuration.variant == variant
        }
        ?: return null

    return ReviewReactionLottieConfiguration(
        composition = compositionStore[variant],
        frameScale = assetConfiguration.frameScale,
        centerX = assetConfiguration.centerX,
        centerY = assetConfiguration.centerY
    )
}

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    events: List<ReviewReactionEvent>,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    val compositionStore: ReviewReactionLottieCompositionStore = reviewReactionLottieAssetConfigurations.associate {
        assetConfiguration: ReviewReactionLottieAssetConfiguration ->
        assetConfiguration.variant to rememberReviewReactionLottieComposition(
            rawResourceId = assetConfiguration.rawResourceId,
            assetName = assetConfiguration.assetName
        )
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
