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
import com.flashcardsopensourceapp.data.local.model.ReviewRating
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TestAnimationsRoute(
    reviewReactionLottieConfigurationStore: ReviewReactionLottieConfigurationStore,
    onBack: () -> Unit
) {
    var activeReviewReactionEvents by remember {
        mutableStateOf<List<ReviewReactionEvent>>(value = emptyList())
    }
    val reviewReactionMotionMode: ReviewReactionMotionMode = reviewReactionMotionModeFromAnimatorSettings()

    fun playAnimation(entry: ReviewReactionVariantDistributionEntry) {
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
                        TestAnimationRatingCard(
                            entries = reviewReactionVariantDistributionEntries(rating = rating),
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
    entries: List<ReviewReactionVariantDistributionEntry>,
    onPlayAnimation: (ReviewReactionVariantDistributionEntry) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        entries.forEach { entry: ReviewReactionVariantDistributionEntry ->
            val probabilityText: String = testAnimationProbabilityText(entry = entry)
            val playContentDescription: String = testAnimationPlayContentDescription(
                entry = entry,
                probabilityText = probabilityText
            )
            ListItem(
                headlineContent = {
                    Text(
                        text = entry.variant.debugIdentifier,
                        style = MaterialTheme.typography.bodyLarge
                    )
                },
                supportingContent = {
                    Text(probabilityText)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics {
                        contentDescription = playContentDescription
                    }
                    .clickable {
                        onPlayAnimation(entry)
                    }
            )
        }
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
private fun testAnimationPlayContentDescription(
    entry: ReviewReactionVariantDistributionEntry,
    probabilityText: String
): String {
    return stringResource(
        R.string.review_test_animations_play_content_description,
        entry.variant.debugIdentifier,
        probabilityText
    )
}
