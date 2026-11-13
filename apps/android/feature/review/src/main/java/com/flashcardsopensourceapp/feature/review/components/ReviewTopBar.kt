package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material3.Badge
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsAppearance
import com.flashcardsopensourceapp.core.ui.theme.LocalFlashcardsAppearance
import java.text.NumberFormat

private val reviewTopBarFilterLabelMaxWidth = 80.dp
private val reviewLeaderboardTrophyDarkColor = Color(0xFFFFD60A)
private val reviewLeaderboardTrophyLightColor = Color(0xFFC98A00)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewTopBar(
    isLoading: Boolean,
    remainingCount: Int,
    totalCount: Int,
    reviewLeaderboardBadge: ReviewLeaderboardBadgeState,
    reviewProgressBadge: ReviewProgressBadgeState,
    selectedFilterTitle: String,
    onOpenFilter: () -> Unit,
    onOpenPreview: () -> Unit,
    onOpenLeaderboard: () -> Unit,
    onOpenProgress: () -> Unit
) {
    val resources = LocalContext.current.resources
    val progressBadgeContentDescription = resources.getQuantityString(
        R.plurals.review_progress_badge_content_description,
        reviewProgressBadge.streakDays,
        reviewProgressBadge.streakDays
    )
    val progressBadgeStateDescription = stringResource(
        id = if (reviewProgressBadge.hasReviewedToday) {
            R.string.review_progress_badge_reviewed_today
        } else {
            R.string.review_progress_badge_not_reviewed_today
        }
    )

    TopAppBar(
        title = {
            Text(
                text = stringResource(id = R.string.review_title),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        actions = {
            FilterChip(
                selected = false,
                enabled = isLoading.not(),
                onClick = onOpenFilter,
                label = {
                    Text(
                        text = selectedFilterTitle,
                        modifier = Modifier.widthIn(max = reviewTopBarFilterLabelMaxWidth),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.FilterList,
                        contentDescription = null
                    )
                },
                trailingIcon = if (remainingCount > 0) {
                    { ReviewFilterDueBadge(count = remainingCount) }
                } else {
                    null
                },
                modifier = Modifier
                    .weight(weight = 1f, fill = false)
                    .testTag(reviewFilterButtonTag)
            )

            ReviewQueueAction(
                isLoading = isLoading,
                totalCount = totalCount,
                onOpenPreview = onOpenPreview
            )

            ReviewLeaderboardAction(
                reviewLeaderboardBadge = reviewLeaderboardBadge,
                onOpenLeaderboard = onOpenLeaderboard
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .testTag(reviewProgressBadgeTag)
                    .semantics {
                        contentDescription = progressBadgeContentDescription
                        stateDescription = progressBadgeStateDescription
                    }
                    .clip(CircleShape)
                    .clickable(
                        enabled = reviewProgressBadge.isInteractive,
                        onClick = onOpenProgress
                    )
                    .heightIn(min = 48.dp)
                    .padding(start = 8.dp, end = 16.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.LocalFireDepartment,
                    contentDescription = null,
                    tint = if (reviewProgressBadge.hasReviewedToday) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
                Text(text = formatReviewProgressBadgeValue(streakDays = reviewProgressBadge.streakDays))
            }
        }
    )
}

@Composable
private fun ReviewFilterDueBadge(count: Int) {
    val badgeContentDescription = pluralStringResource(
        R.plurals.review_filter_due_badge_content_description,
        count,
        count
    )
    val locale = LocalConfiguration.current.locales[0]
    val countFormatter = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    Badge(
        modifier = Modifier.clearAndSetSemantics {
            contentDescription = badgeContentDescription
        }
    ) {
        Text(text = countFormatter.format(count))
    }
}

@Composable
private fun ReviewLeaderboardAction(
    reviewLeaderboardBadge: ReviewLeaderboardBadgeState,
    onOpenLeaderboard: () -> Unit
) {
    val rank = reviewLeaderboardBadge.rank
    val contentDescription = if (rank == null) {
        stringResource(id = R.string.review_leaderboard_shortcut_content_description)
    } else {
        stringResource(
            id = R.string.review_leaderboard_shortcut_rank_content_description,
            rank
        )
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .testTag(reviewLeaderboardShortcutTag)
            .semantics {
                this.contentDescription = contentDescription
            }
            .clip(CircleShape)
            .clickable(
                enabled = reviewLeaderboardBadge.isInteractive,
                onClick = onOpenLeaderboard
            )
            .heightIn(min = 48.dp)
            .widthIn(min = 48.dp)
            .padding(start = 8.dp, end = if (rank == null) 8.dp else 16.dp)
    ) {
        Icon(
            imageVector = Icons.Outlined.EmojiEvents,
            contentDescription = null,
            tint = when (LocalFlashcardsAppearance.current) {
                FlashcardsAppearance.DARK -> reviewLeaderboardTrophyDarkColor
                FlashcardsAppearance.LIGHT -> reviewLeaderboardTrophyLightColor
            }
        )
        if (rank != null) {
            Text(text = rank.toString())
        }
    }
}

@Composable
private fun ReviewQueueAction(
    isLoading: Boolean,
    totalCount: Int,
    onOpenPreview: () -> Unit
) {
    if (isLoading) {
        CircularProgressIndicator(
            strokeWidth = 2.dp,
            modifier = Modifier
                .padding(end = 4.dp)
                .size(20.dp)
        )
        return
    }
    val resources = LocalContext.current.resources
    val queueContentDescription = resources.getQuantityString(
        R.plurals.review_queue_button_content_description,
        totalCount,
        totalCount
    )

    IconButton(
        onClick = onOpenPreview,
        enabled = totalCount > 0,
        modifier = Modifier
            .testTag(reviewQueueButtonTag)
            .semantics {
                contentDescription = queueContentDescription
            }
    ) {
        Icon(
            imageVector = Icons.AutoMirrored.Outlined.FormatListBulleted,
            contentDescription = null
        )
    }
}
