package com.flashcardsopensourceapp.feature.progress

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private const val progressStreakOverflowThreshold: Int = 99

@Composable
internal fun StreakSectionCard(
    summary: ProgressSummaryUiState,
    uiState: ProgressStreakSectionUiState
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressStreakSectionTag),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer
        ),
        shape = progressSectionShape
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = stringResource(id = R.string.progress_streak_title),
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = stringResource(id = R.string.progress_streak_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium
                )
            }

            ProgressStreakSummary(summary = summary)

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                uiState.weekdayLabels.forEach { label ->
                    Text(
                        text = label,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                uiState.weeks.forEach { week ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        week.days.forEach { day ->
                            StreakDayCell(
                                day = day,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProgressStreakSummary(
    summary: ProgressSummaryUiState
) {
    when (summary) {
        ProgressSummaryUiState.Loading -> Unit

        is ProgressSummaryUiState.Loaded -> {
            val streakDays = summary.summary.currentStreakDays
            val contentColor = if (summary.summary.hasReviewedToday) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            }
            val contentDescription = pluralStringResource(
                id = R.plurals.progress_streak_summary_content_description,
                count = streakDays,
                streakDays
            )
            val stateDescription = stringResource(
                id = if (summary.summary.hasReviewedToday) {
                    R.string.progress_streak_summary_reviewed_today
                } else {
                    R.string.progress_streak_summary_not_reviewed_today
                }
            )

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .semantics(mergeDescendants = true) {
                        this.contentDescription = contentDescription
                        this.stateDescription = stateDescription
                    }
                    .clip(RoundedCornerShape(18.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.LocalFireDepartment,
                    contentDescription = null,
                    tint = contentColor
                )
                Text(
                    text = formatProgressStreakValue(
                        streakDays = streakDays
                    ),
                    color = contentColor,
                    fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleMedium
                )
            }
        }
    }
}

@Composable
private fun StreakDayCell(
    day: ProgressStreakDayUiState,
    modifier: Modifier
) {
    if (day.isPlaceholder) {
        Box(
            modifier = modifier.aspectRatio(1f)
        )
        return
    }

    val hasReviews = day.reviewCount > 0
    val highlightColor = when {
        hasReviews -> Color.Transparent
        day.isToday -> MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
        else -> Color.Transparent
    }
    val markerColor = MaterialTheme.colorScheme.primary
    val markerContentColor = MaterialTheme.colorScheme.onPrimary
    val dateTextColor = when {
        day.isToday -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurface
    }

    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(18.dp))
            .background(highlightColor),
        contentAlignment = Alignment.Center
    ) {
        if (hasReviews) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(markerColor),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Outlined.LocalFireDepartment,
                    contentDescription = null,
                    tint = markerContentColor
                )
            }
        } else {
            val todayOutlineModifier = if (day.isToday) {
                Modifier.border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.primary,
                    shape = CircleShape
                )
            } else {
                Modifier
            }

            Box(
                modifier = Modifier
                    .size(34.dp)
                    .then(todayOutlineModifier),
                contentAlignment = Alignment.Center
            ) {
                day.dayOfMonthLabel?.let { dayOfMonthLabel ->
                    Text(
                        text = dayOfMonthLabel,
                        color = dateTextColor,
                        fontWeight = if (day.isToday) FontWeight.SemiBold else FontWeight.Normal,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

private fun formatProgressStreakValue(
    streakDays: Int
): String {
    if (streakDays > progressStreakOverflowThreshold) {
        return "${progressStreakOverflowThreshold}+"
    }

    return streakDays.toString()
}
