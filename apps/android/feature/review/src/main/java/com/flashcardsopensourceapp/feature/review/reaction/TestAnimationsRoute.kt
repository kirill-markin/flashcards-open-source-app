package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.feature.review.R
import java.util.UUID
import kotlin.math.roundToInt

internal const val testAnimationsScreenTag: String = "test_animations_screen"

private val testAnimationRatingOrder: List<ReviewRating> = listOf(
    ReviewRating.AGAIN,
    ReviewRating.HARD,
    ReviewRating.GOOD,
    ReviewRating.EASY
)

private data class TestAnimationEntryUiState(
    val entry: ReviewReactionVariantDistributionEntry,
    val availability: TestAnimationAvailability
)

private enum class TestAnimationAvailability {
    PLAYABLE,
    LOADING,
    PAUSED_BY_BATTERY_SAVER
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TestAnimationsRoute(
    isPowerSaveMode: Boolean,
    onBack: () -> Unit
) {
    var activeReviewReactionEvents by remember {
        mutableStateOf<List<ReviewReactionEvent>>(value = emptyList())
    }
    val reviewReactionMotionMode: ReviewReactionMotionMode = reviewReactionMotionModeFromAnimatorSettings()
    val reviewReactionLottieConfigurationStore = rememberReviewReactionLottieConfigurationStore(
        loadLottieCompositions = isPowerSaveMode.not()
    )

    fun playAnimation(entry: ReviewReactionVariantDistributionEntry) {
        val availability: TestAnimationAvailability = testAnimationAvailability(
            entry = entry,
            isPowerSaveMode = isPowerSaveMode,
            configurationStore = reviewReactionLottieConfigurationStore
        )
        if (availability != TestAnimationAvailability.PLAYABLE) {
            return
        }

        val event = ReviewReactionEvent(
            id = UUID.randomUUID().toString(),
            rating = entry.rating,
            variant = entry.variant
        )
        activeReviewReactionEvents = appendReviewReactionEvent(
            events = activeReviewReactionEvents,
            event = event,
            maximumActiveEvents = reviewReactionMaximumActiveEvents
        )
    }

    LaunchedEffect(isPowerSaveMode) {
        if (isPowerSaveMode) {
            activeReviewReactionEvents = emptyList()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(R.string.review_test_animations_title))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.review_preview_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding: PaddingValues ->
        Box(modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 24.dp
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .testTag(tag = testAnimationsScreenTag)
            ) {
                testAnimationRatingOrder.forEach { rating: ReviewRating ->
                    item {
                        SectionTitle(text = reviewReactionRatingTitle(rating = rating))
                    }

                    item {
                        val entryUiStates: List<TestAnimationEntryUiState> =
                            reviewReactionVariantDistributionEntries(rating = rating)
                                .map { entry: ReviewReactionVariantDistributionEntry ->
                                    TestAnimationEntryUiState(
                                        entry = entry,
                                        availability = testAnimationAvailability(
                                            entry = entry,
                                            isPowerSaveMode = isPowerSaveMode,
                                            configurationStore = reviewReactionLottieConfigurationStore
                                        )
                                    )
                                }
                        TestAnimationRatingCard(
                            entryUiStates = entryUiStates,
                            onPlayAnimation = { entry: ReviewReactionVariantDistributionEntry ->
                                playAnimation(entry = entry)
                            }
                        )
                    }
                }
            }

            ReviewReactionOverlay(
                modifier = Modifier.fillMaxSize(),
                events = activeReviewReactionEvents,
                motionMode = reviewReactionMotionMode,
                configurationStore = reviewReactionLottieConfigurationStore,
                onEventFinished = { eventId: String ->
                    activeReviewReactionEvents = activeReviewReactionEvents.filter { event: ReviewReactionEvent ->
                        event.id != eventId
                    }
                }
            )
        }
    }
}

@Composable
private fun TestAnimationRatingCard(
    entryUiStates: List<TestAnimationEntryUiState>,
    onPlayAnimation: (ReviewReactionVariantDistributionEntry) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        entryUiStates.forEach { uiState: TestAnimationEntryUiState ->
            val entry: ReviewReactionVariantDistributionEntry = uiState.entry
            val isPlayable: Boolean = uiState.availability == TestAnimationAvailability.PLAYABLE
            val probabilityText: String = testAnimationProbabilityText(entry = entry)
            val supportingText: String = testAnimationSupportingText(
                availability = uiState.availability,
                probabilityText = probabilityText
            )
            val rowContentDescription: String = testAnimationContentDescription(
                entry = entry,
                availability = uiState.availability,
                supportingText = supportingText
            )
            ListItem(
                headlineContent = {
                    Text(
                        text = entry.variant.debugIdentifier,
                        style = MaterialTheme.typography.bodyLarge
                    )
                },
                supportingContent = {
                    Text(supportingText)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics {
                        contentDescription = rowContentDescription
                    }
                    .clickable(
                        enabled = isPlayable,
                        onClick = {
                            onPlayAnimation(entry)
                        }
                    )
            )
        }
    }
}

private fun testAnimationAvailability(
    entry: ReviewReactionVariantDistributionEntry,
    isPowerSaveMode: Boolean,
    configurationStore: ReviewReactionLottieConfigurationStore
): TestAnimationAvailability {
    if (isPowerSaveMode) {
        return TestAnimationAvailability.PAUSED_BY_BATTERY_SAVER
    }

    val configuration: ReviewReactionLottieConfiguration = reviewReactionLottieConfiguration(
        variant = entry.variant,
        configurationStore = configurationStore
    ) ?: error(
        "Test animation Lottie configuration is missing. " +
            "variant=${entry.variant.debugIdentifier}"
    )

    return when (configuration.readiness) {
        is ReviewReactionLottieReadiness.Ready -> TestAnimationAvailability.PLAYABLE
        ReviewReactionLottieReadiness.Pending -> TestAnimationAvailability.LOADING
        is ReviewReactionLottieReadiness.Failed -> TestAnimationAvailability.PLAYABLE
    }
}

@Composable
private fun reviewReactionRatingTitle(rating: ReviewRating): String {
    return when (rating) {
        ReviewRating.AGAIN -> stringResource(R.string.review_again)
        ReviewRating.HARD -> stringResource(R.string.review_hard)
        ReviewRating.GOOD -> stringResource(R.string.review_good)
        ReviewRating.EASY -> stringResource(R.string.review_easy)
    }
}

@Composable
private fun testAnimationProbabilityText(entry: ReviewReactionVariantDistributionEntry): String {
    return stringResource(
        R.string.review_test_animations_probability,
        entry.probabilityPercent.roundToInt()
    )
}

@Composable
private fun testAnimationSupportingText(
    availability: TestAnimationAvailability,
    probabilityText: String
): String {
    return when (availability) {
        TestAnimationAvailability.PLAYABLE -> probabilityText
        TestAnimationAvailability.LOADING -> stringResource(R.string.review_test_animations_loading)
        TestAnimationAvailability.PAUSED_BY_BATTERY_SAVER ->
            stringResource(R.string.review_test_animations_battery_saver_paused)
    }
}

@Composable
private fun testAnimationContentDescription(
    entry: ReviewReactionVariantDistributionEntry,
    availability: TestAnimationAvailability,
    supportingText: String
): String {
    return when (availability) {
        TestAnimationAvailability.PLAYABLE -> stringResource(
            R.string.review_test_animations_play_content_description,
            entry.variant.debugIdentifier,
            supportingText
        )

        TestAnimationAvailability.LOADING,
        TestAnimationAvailability.PAUSED_BY_BATTERY_SAVER -> stringResource(
            R.string.review_test_animations_status_content_description,
            entry.variant.debugIdentifier,
            supportingText
        )
    }
}
