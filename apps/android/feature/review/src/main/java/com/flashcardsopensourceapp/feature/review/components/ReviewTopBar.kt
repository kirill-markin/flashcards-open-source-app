package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private val reviewTopBarFilterMaxWidth = 160.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewTopBar(
    isLoading: Boolean,
    totalCount: Int,
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
            Text(stringResource(id = R.string.review_title))
        },
        actions = {
            FilterChip(
                selected = false,
                onClick = onOpenFilter,
                label = {
                    Text(
                        text = selectedFilterTitle,
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
                modifier = Modifier
                    .widthIn(max = reviewTopBarFilterMaxWidth)
                    .testTag(reviewFilterButtonTag)
            )

            ReviewQueueAction(
                isLoading = isLoading,
                totalCount = totalCount,
                onOpenPreview = onOpenPreview
            )

            IconButton(
                onClick = onOpenLeaderboard,
                modifier = Modifier.testTag(reviewLeaderboardShortcutTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.EmojiEvents,
                    contentDescription = stringResource(
                        id = R.string.review_leaderboard_shortcut_content_description
                    )
                )
            }

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

    TextButton(
        onClick = onOpenPreview,
        enabled = totalCount > 0,
        colors = ButtonDefaults.textButtonColors(
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant
        ),
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
        modifier = Modifier
            .testTag(reviewQueueButtonTag)
            .semantics {
                contentDescription = queueContentDescription
            }
    ) {
        Icon(
            imageVector = Icons.Outlined.FormatListBulleted,
            contentDescription = null
        )
        Spacer(modifier = Modifier.size(6.dp))
        Text(text = totalCount.toString())
    }
}
