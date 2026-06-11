package com.flashcardsopensourceapp.feature.progress

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import java.text.NumberFormat
import java.util.Locale

private const val leaderboardReservedRowCount: Int = 7

@Composable
internal fun LeaderboardSectionCard(
    uiState: ProgressLeaderboardSectionUiState,
    onSelectWindow: (ProgressLeaderboardWindowKey) -> Unit,
    onOpenSignIn: () -> Unit,
    onOpenAccountSettings: () -> Unit
) {
    var isInfoDialogVisible by rememberSaveable { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressLeaderboardSectionTag),
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
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = stringResource(id = R.string.progress_leaderboard_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = { isInfoDialogVisible = true },
                    modifier = Modifier.testTag(progressLeaderboardInfoButtonTag)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Info,
                        contentDescription = stringResource(
                            id = R.string.progress_leaderboard_info_button_content_description
                        )
                    )
                }
            }

            when (uiState) {
                ProgressLeaderboardSectionUiState.Loading -> {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 16.dp)
                    ) {
                        CircularProgressIndicator()
                    }
                }

                ProgressLeaderboardSectionUiState.SignInRequired -> {
                    LeaderboardPlaceholder(
                        message = stringResource(id = R.string.progress_leaderboard_sign_in_message),
                        buttonLabel = stringResource(id = R.string.progress_leaderboard_sign_in_button),
                        onButtonClick = onOpenSignIn
                    )
                }

                ProgressLeaderboardSectionUiState.ParticipationDisabled -> {
                    LeaderboardPlaceholder(
                        message = stringResource(id = R.string.progress_leaderboard_participation_disabled_message),
                        buttonLabel = stringResource(id = R.string.progress_leaderboard_participation_disabled_button),
                        onButtonClick = onOpenAccountSettings
                    )
                }

                ProgressLeaderboardSectionUiState.Offline -> {
                    LeaderboardPlaceholder(
                        message = stringResource(id = R.string.progress_leaderboard_offline_message),
                        buttonLabel = null,
                        onButtonClick = null
                    )
                }

                ProgressLeaderboardSectionUiState.SnapshotUnavailable -> {
                    LeaderboardPlaceholder(
                        message = stringResource(id = R.string.progress_leaderboard_unavailable_message),
                        buttonLabel = null,
                        onButtonClick = null
                    )
                }

                is ProgressLeaderboardSectionUiState.Ready -> {
                    LeaderboardReadyContent(
                        uiState = uiState,
                        onSelectWindow = onSelectWindow
                    )
                }
            }
        }
    }

    if (isInfoDialogVisible) {
        val fallbackInfoBody = stringResource(id = R.string.progress_leaderboard_info_fallback_body)
        val infoBody = (uiState as? ProgressLeaderboardSectionUiState.Ready)?.metricDescription
            ?: fallbackInfoBody
        AlertDialog(
            onDismissRequest = { isInfoDialogVisible = false },
            confirmButton = {
                TextButton(onClick = { isInfoDialogVisible = false }) {
                    Text(stringResource(id = R.string.progress_leaderboard_info_dismiss))
                }
            },
            title = {
                Text(stringResource(id = R.string.progress_leaderboard_info_title))
            },
            text = {
                Text(infoBody)
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaderboardReadyContent(
    uiState: ProgressLeaderboardSectionUiState.Ready,
    onSelectWindow: (ProgressLeaderboardWindowKey) -> Unit
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

    SingleChoiceSegmentedButtonRow(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressLeaderboardPeriodSelectorTag)
    ) {
        uiState.windows.forEachIndexed { index, window ->
            SegmentedButton(
                selected = uiState.selectedWindowKey == window.windowKey,
                onClick = {
                    onSelectWindow(window.windowKey)
                },
                shape = SegmentedButtonDefaults.itemShape(
                    index = index,
                    count = uiState.windows.size
                ),
                label = {
                    Text(
                        text = leaderboardWindowLabel(windowKey = window.windowKey),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            )
        }
    }

    val selectedWindow = uiState.selectedWindow
    if (selectedWindow == null || selectedWindow.rows.isEmpty()) {
        Text(
            text = stringResource(id = R.string.progress_leaderboard_empty_window),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
    } else {
        Text(
            text = pluralStringResource(
                id = R.plurals.progress_leaderboard_participant_count,
                count = selectedWindow.participantCount,
                countFormatter.format(selectedWindow.participantCount.toLong())
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            selectedWindow.rows.forEach { row ->
                when (row) {
                    ProgressLeaderboardRowUiState.Gap -> LeaderboardGapRow()
                    is ProgressLeaderboardRowUiState.Participant -> LeaderboardParticipantRow(
                        row = row,
                        rankLabel = countFormatter.format(row.rank.toLong()),
                        countLabel = countFormatter.format(row.qualifiedReviewCount.toLong())
                    )
                }
            }

            repeat(leaderboardReservedRowPlaceholderCount(rowCount = selectedWindow.rows.size)) {
                LeaderboardReservedRow()
            }
        }

        val snapshotGeneratedAtMillis = selectedWindow.snapshotGeneratedAtMillis
        if (uiState.isStale && snapshotGeneratedAtMillis != null) {
            Text(
                text = stringResource(
                    id = R.string.progress_leaderboard_updated_label,
                    DateUtils.getRelativeTimeSpanString(snapshotGeneratedAtMillis).toString()
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

private fun leaderboardReservedRowPlaceholderCount(rowCount: Int): Int {
    return maxOf(0, leaderboardReservedRowCount - rowCount)
}

@Composable
private fun LeaderboardParticipantRow(
    row: ProgressLeaderboardRowUiState.Participant,
    rankLabel: String,
    countLabel: String
) {
    val emphasisColor = MaterialTheme.colorScheme.primary
    val rowColor = if (row.isViewer) emphasisColor else MaterialTheme.colorScheme.onSurface
    val rowWeight = if (row.isViewer) FontWeight.SemiBold else null

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = stringResource(id = R.string.progress_leaderboard_rank_label, rankLabel),
            color = if (row.isViewer) emphasisColor else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight
        )
        Text(
            text = if (row.isViewer) {
                stringResource(id = R.string.progress_leaderboard_you)
            } else {
                row.displayName
            },
            color = rowColor,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = countLabel,
            color = rowColor,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight,
            textAlign = TextAlign.End
        )
    }
}

@Composable
private fun LeaderboardReservedRow() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .alpha(0f)
            .clearAndSetSemantics {}
    ) {
        Text(
            text = "0",
            style = MaterialTheme.typography.bodyMedium
        )
        Text(
            text = "Reserved leaderboard row",
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = "0",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End
        )
    }
}

@Composable
private fun LeaderboardGapRow() {
    val gapContentDescription = stringResource(id = R.string.progress_leaderboard_gap_content_description)
    Text(
        text = "⋯",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = gapContentDescription
            }
    )
}

@Composable
private fun LeaderboardPlaceholder(
    message: String,
    buttonLabel: String?,
    onButtonClick: (() -> Unit)?
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = message,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
        if (buttonLabel != null && onButtonClick != null) {
            FilledTonalButton(onClick = onButtonClick) {
                Text(buttonLabel)
            }
        }
    }
}

@Composable
private fun leaderboardWindowLabel(
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
