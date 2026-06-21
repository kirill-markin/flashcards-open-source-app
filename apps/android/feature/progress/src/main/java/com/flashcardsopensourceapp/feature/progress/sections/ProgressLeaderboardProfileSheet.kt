package com.flashcardsopensourceapp.feature.progress.sections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardProfileReadyUiState
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardProfileReviewActivityDayUiState
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardProfileSheetUiState
import com.flashcardsopensourceapp.feature.progress.R
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val leaderboardProfileMetricShape = RoundedCornerShape(8.dp)
private val leaderboardProfileBarShape = RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)
private val leaderboardProfileMaximumBarHeight: Dp = 48.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProgressLeaderboardProfileSheet(
    uiState: ProgressLeaderboardProfileSheetUiState,
    onDismiss: () -> Unit,
    onRetry: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag(progressLeaderboardProfileSheetTag)
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp)
        ) {
            ProgressLeaderboardProfileHeader(uiState = uiState)
            when (uiState) {
                is ProgressLeaderboardProfileSheetUiState.Loading -> ProgressLeaderboardProfileLoading()
                is ProgressLeaderboardProfileSheetUiState.Ready -> ProgressLeaderboardProfileReadyContent(
                    profile = uiState.profile
                )
                is ProgressLeaderboardProfileSheetUiState.Unavailable -> ProgressLeaderboardProfileUnavailable(
                    status = uiState.status
                )
                is ProgressLeaderboardProfileSheetUiState.Error -> ProgressLeaderboardProfileError(onRetry = onRetry)
            }
        }
    }
}

@Composable
private fun ProgressLeaderboardProfileHeader(
    uiState: ProgressLeaderboardProfileSheetUiState
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = leaderboardProfileDisplayName(uiState = uiState),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            val readyState = uiState as? ProgressLeaderboardProfileSheetUiState.Ready
            val selectedProfileLooksFriend = readyState == null &&
                uiState.selectedProfile.friendDisplayName != null &&
                uiState.selectedProfile.isViewer.not()
            val isFriend = readyState?.profile?.isFriend == true || selectedProfileLooksFriend
            if (isFriend) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    shape = leaderboardProfileMetricShape
                ) {
                    Text(
                        text = stringResource(id = R.string.progress_leaderboard_profile_friend_label),
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun ProgressLeaderboardProfileLoading() {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 24.dp)
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun ProgressLeaderboardProfileReadyContent(
    profile: ProgressLeaderboardProfileReadyUiState
) {
    val configuration = LocalConfiguration.current
    val locale = if (configuration.locales.isEmpty) {
        Locale.getDefault()
    } else {
        configuration.locales[0]
    }
    val countFormatter = remember(locale) {
        NumberFormat.getIntegerInstance(locale)
    }
    val dateFormatter = remember(locale) {
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    }

    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            ProgressLeaderboardProfileMetric(
                label = stringResource(id = R.string.progress_leaderboard_profile_current_streak_label),
                value = pluralStringResource(
                    id = R.plurals.progress_streak_leaderboard_day_count,
                    count = profile.currentStreakDays,
                    countFormatter.format(profile.currentStreakDays.toLong())
                ),
                modifier = Modifier.weight(1f)
            )
            val bestRatingValue = profile.bestRatingPlacement?.let { placement ->
                val rankLabel = stringResource(
                    id = R.string.progress_leaderboard_rank_label,
                    countFormatter.format(placement.rank.toLong())
                )
                stringResource(
                    id = R.string.progress_leaderboard_profile_best_rating_value,
                    rankLabel,
                    leaderboardProfileWindowLabel(windowKey = placement.windowKey)
                )
            } ?: stringResource(id = R.string.progress_leaderboard_profile_no_rating_value)
            ProgressLeaderboardProfileMetric(
                label = stringResource(id = R.string.progress_leaderboard_profile_best_rating_label),
                value = bestRatingValue,
                modifier = Modifier.weight(1f)
            )
        }

        ProgressLeaderboardProfileReviewActivity(
            days = profile.reviewActivityDays,
            countFormatter = countFormatter
        )

        HorizontalDivider()

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = stringResource(
                    id = R.string.progress_leaderboard_profile_joined_value,
                    dateFormatter.format(profile.joinedDate)
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = pluralStringResource(
                    id = R.plurals.progress_leaderboard_profile_total_cards_value,
                    count = profile.totalCards,
                    countFormatter.format(profile.totalCards.toLong())
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@Composable
private fun ProgressLeaderboardProfileMetric(
    label: String,
    value: String,
    modifier: Modifier
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = leaderboardProfileMetricShape,
        modifier = modifier
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(12.dp)
        ) {
            Text(
                text = label,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelMedium
            )
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ProgressLeaderboardProfileReviewActivity(
    days: List<ProgressLeaderboardProfileReviewActivityDayUiState>,
    countFormatter: NumberFormat
) {
    val maximumReviewCount = days.maxOfOrNull { day -> day.reviewCount } ?: 0
    val activityContentDescription = stringResource(
        id = R.string.progress_leaderboard_profile_activity_chart_content_description
    )

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val totalReviews = days.sumOf { day -> day.reviewCount }
        Text(
            text = stringResource(id = R.string.progress_leaderboard_profile_activity_title),
            style = MaterialTheme.typography.titleMedium
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .height(leaderboardProfileMaximumBarHeight)
                .testTag(progressLeaderboardProfileActivityChartTag)
                .clearAndSetSemantics {
                    contentDescription = activityContentDescription
                }
        ) {
            days.forEach { day ->
                ProgressLeaderboardProfileActivityBar(
                    reviewCount = day.reviewCount,
                    maximumReviewCount = maximumReviewCount,
                    modifier = Modifier.weight(1f)
                )
            }
        }
        Text(
            text = pluralStringResource(
                id = R.plurals.progress_leaderboard_profile_activity_total,
                count = totalReviews,
                countFormatter.format(totalReviews.toLong())
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun ProgressLeaderboardProfileActivityBar(
    reviewCount: Int,
    maximumReviewCount: Int,
    modifier: Modifier
) {
    val fraction = if (maximumReviewCount == 0) {
        0f
    } else {
        reviewCount.toFloat() / maximumReviewCount.toFloat()
    }
    val barHeight = when {
        reviewCount == 0 -> 3.dp
        else -> leaderboardProfileMaximumBarHeight * fraction.coerceIn(0.16f, 1f)
    }
    val barColor = if (reviewCount == 0) {
        MaterialTheme.colorScheme.surfaceContainerHighest
    } else {
        MaterialTheme.colorScheme.primary
    }

    Box(
        contentAlignment = Alignment.BottomCenter,
        modifier = modifier.fillMaxHeight()
    ) {
        Spacer(
            modifier = Modifier
                .fillMaxWidth()
                .height(barHeight)
                .clip(leaderboardProfileBarShape)
                .background(barColor)
        )
    }
}

@Composable
private fun ProgressLeaderboardProfileUnavailable(
    status: ProgressLeaderboardProfileStatus
) {
    val messageResId = when (status) {
        ProgressLeaderboardProfileStatus.LINKED_ACCOUNT_REQUIRED -> {
            R.string.progress_leaderboard_profile_linked_account_required_message
        }
        ProgressLeaderboardProfileStatus.PARTICIPATION_DISABLED -> {
            R.string.progress_leaderboard_profile_participation_disabled_message
        }
        ProgressLeaderboardProfileStatus.PROFILE_UNAVAILABLE -> {
            R.string.progress_leaderboard_profile_unavailable_message
        }
        ProgressLeaderboardProfileStatus.READY -> {
            throw IllegalStateException("Unavailable leaderboard profile sheet must not use ready status.")
        }
    }

    Text(
        text = stringResource(id = messageResId),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium
    )
}

@Composable
private fun ProgressLeaderboardProfileError(
    onRetry: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = stringResource(id = R.string.progress_leaderboard_profile_error_message),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
        Button(
            onClick = onRetry,
            modifier = Modifier.testTag(progressLeaderboardProfileRetryButtonTag)
        ) {
            Text(stringResource(id = R.string.progress_retry))
        }
    }
}

@Composable
private fun leaderboardProfileDisplayName(
    uiState: ProgressLeaderboardProfileSheetUiState
): String {
    if (uiState.selectedProfile.isViewer) {
        return stringResource(id = R.string.progress_leaderboard_you)
    }

    val readyProfile = (uiState as? ProgressLeaderboardProfileSheetUiState.Ready)?.profile
    return readyProfile?.friendDisplayName
        ?: readyProfile?.anonymousDisplayName
        ?: uiState.selectedProfile.displayName
}

@Composable
private fun leaderboardProfileWindowLabel(
    windowKey: ProgressLeaderboardWindowKey
): String {
    val stringResId = when (windowKey) {
        ProgressLeaderboardWindowKey.LAST_24_HOURS -> R.string.progress_leaderboard_window_last_24_hours
        ProgressLeaderboardWindowKey.LAST_3_DAYS -> R.string.progress_leaderboard_window_last_3_days
        ProgressLeaderboardWindowKey.LAST_7_DAYS -> R.string.progress_leaderboard_window_last_7_days
        ProgressLeaderboardWindowKey.LAST_30_DAYS -> R.string.progress_leaderboard_window_last_30_days
        ProgressLeaderboardWindowKey.ALL_TIME -> R.string.progress_leaderboard_window_all_time
    }

    return stringResource(id = stringResId)
}
