package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.HourglassBottom
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ReviewRating

internal val reviewBottomOverlayBottomPadding = 12.dp
private val reviewBottomOverlayHorizontalPadding = 16.dp
private val reviewShowAnswerButtonMinHeight = 64.dp
private val reviewRatingButtonMinHeight = 68.dp

@Composable
internal fun ReviewBottomActionOverlay(
    modifier: Modifier,
    currentCard: PreparedReviewCardPresentation,
    isAnswerVisible: Boolean,
    bottomInsetPadding: Dp,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color.Transparent,
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.92f)
                    )
                )
            )
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(
                    start = reviewBottomOverlayHorizontalPadding,
                    top = 40.dp,
                    end = reviewBottomOverlayHorizontalPadding,
                    bottom = bottomInsetPadding
                )
        ) {
            if (isAnswerVisible) {
                ReviewAnswerButtonGrid(
                    answerOptions = currentCard.answerOptions,
                    onRateAgain = onRateAgain,
                    onRateHard = onRateHard,
                    onRateGood = onRateGood,
                    onRateEasy = onRateEasy
                )
            } else {
                Button(
                    onClick = onRevealAnswer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = reviewShowAnswerButtonMinHeight)
                        .testTag(reviewShowAnswerButtonTag)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Visibility,
                            contentDescription = null
                        )
                        Text(stringResource(id = R.string.review_show_answer))
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewAnswerButtonGrid(
    answerOptions: List<PreparedReviewAnswerOption>,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        answerOptions.chunked(size = 2).forEach { rowOptions ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                rowOptions.forEach { option ->
                    RatingButton(
                        option = option,
                        onClick = when (option.rating) {
                            ReviewRating.AGAIN -> onRateAgain
                            ReviewRating.HARD -> onRateHard
                            ReviewRating.GOOD -> onRateGood
                            ReviewRating.EASY -> onRateEasy
                        },
                        modifier = Modifier.weight(1f)
                    )
                }

                if (rowOptions.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

private data class ReviewRatingPresentation(
    val icon: ImageVector
)

private fun reviewRatingPresentation(rating: ReviewRating): ReviewRatingPresentation {
    return when (rating) {
        ReviewRating.AGAIN -> ReviewRatingPresentation(
            icon = Icons.Outlined.Autorenew
        )

        ReviewRating.HARD -> ReviewRatingPresentation(
            icon = Icons.Outlined.HourglassBottom
        )

        ReviewRating.GOOD -> ReviewRatingPresentation(
            icon = Icons.Outlined.CheckCircleOutline
        )

        ReviewRating.EASY -> ReviewRatingPresentation(
            icon = Icons.Outlined.AutoAwesome
        )
    }
}

@Composable
private fun RatingButton(
    option: PreparedReviewAnswerOption,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val presentation = reviewRatingPresentation(rating = option.rating)
    val title = when (option.rating) {
        ReviewRating.AGAIN -> stringResource(id = R.string.review_again)
        ReviewRating.HARD -> stringResource(id = R.string.review_hard)
        ReviewRating.GOOD -> stringResource(id = R.string.review_good)
        ReviewRating.EASY -> stringResource(id = R.string.review_easy)
    }

    Button(
        onClick = onClick,
        modifier = modifier
            .testTag(
                when (option.rating) {
                    ReviewRating.AGAIN -> reviewRateAgainButtonTag
                    ReviewRating.HARD -> reviewRateHardButtonTag
                    ReviewRating.GOOD -> reviewRateGoodButtonTag
                    ReviewRating.EASY -> reviewRateEasyButtonTag
                }
            )
            .heightIn(min = reviewRatingButtonMinHeight)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = presentation.icon,
                    contentDescription = null
                )
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            Text(
                text = option.intervalDescription,
                style = MaterialTheme.typography.labelSmall
            )
        }
    }
}
