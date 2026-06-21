package com.flashcardsopensourceapp.feature.progress.sections

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardProfileIdentityUiState
import com.flashcardsopensourceapp.feature.progress.ProgressStreakLeaderboardRowUiState
import com.flashcardsopensourceapp.feature.progress.ProgressStreakLeaderboardSectionUiState
import com.flashcardsopensourceapp.feature.progress.R
import java.text.NumberFormat
import java.util.Locale

@Composable
internal fun StreakLeaderboardSectionCard(
    uiState: ProgressStreakLeaderboardSectionUiState,
    onOpenProfile: (ProgressLeaderboardProfileIdentityUiState) -> Unit,
    onOpenSignIn: () -> Unit,
    onOpenLeaderboardSettings: () -> Unit
) {
    var isInfoDialogVisible by rememberSaveable { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(progressStreakLeaderboardSectionTag),
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
                    text = stringResource(id = R.string.progress_streak_leaderboard_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = { isInfoDialogVisible = true },
                    modifier = Modifier.testTag(progressStreakLeaderboardInfoButtonTag)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Info,
                        contentDescription = stringResource(
                            id = R.string.progress_streak_leaderboard_info_button_content_description
                        )
                    )
                }
            }

            when (uiState) {
                ProgressStreakLeaderboardSectionUiState.Loading -> {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 16.dp)
                    ) {
                        CircularProgressIndicator()
                    }
                }

                ProgressStreakLeaderboardSectionUiState.SignInRequired -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressStreakLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_streak_leaderboard_sign_in_message),
                            buttonLabel = stringResource(id = R.string.progress_leaderboard_sign_in_button),
                            onButtonClick = onOpenSignIn
                        )
                    }
                }

                ProgressStreakLeaderboardSectionUiState.ParticipationDisabled -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressStreakLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(
                                id = R.string.progress_streak_leaderboard_participation_disabled_message
                            ),
                            buttonLabel = stringResource(
                                id = R.string.progress_leaderboard_participation_disabled_button
                            ),
                            onButtonClick = onOpenLeaderboardSettings
                        )
                    }
                }

                ProgressStreakLeaderboardSectionUiState.Offline -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressStreakLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_streak_leaderboard_offline_message),
                            buttonLabel = null,
                            onButtonClick = null
                        )
                    }
                }

                ProgressStreakLeaderboardSectionUiState.SnapshotUnavailable -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressStreakLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_streak_leaderboard_unavailable_message),
                            buttonLabel = null,
                            onButtonClick = null
                        )
                    }
                }

                is ProgressStreakLeaderboardSectionUiState.Ready -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressStreakLeaderboardResolvedContentTag
                    ) {
                        ProgressStreakLeaderboardReadyContent(
                            uiState = uiState,
                            onOpenProfile = onOpenProfile
                        )
                    }
                }
            }
        }
    }

    if (isInfoDialogVisible) {
        val readyState = uiState as? ProgressStreakLeaderboardSectionUiState.Ready
        val fallbackInfoBody = stringResource(id = R.string.progress_streak_leaderboard_info_fallback_body)
        val infoBody = readyState?.metricDescription ?: fallbackInfoBody
        val updatedText = readyState?.snapshotGeneratedAtMillis?.let { snapshotGeneratedAtMillis ->
            progressLeaderboardUpdatedLabel(
                elapsedTime = progressLeaderboardElapsedTime(
                    snapshotGeneratedAtMillis = snapshotGeneratedAtMillis,
                    nowMillis = System.currentTimeMillis()
                )
            )
        }
        AlertDialog(
            onDismissRequest = { isInfoDialogVisible = false },
            confirmButton = {
                TextButton(onClick = { isInfoDialogVisible = false }) {
                    Text(stringResource(id = R.string.progress_leaderboard_info_dismiss))
                }
            },
            title = {
                Text(stringResource(id = R.string.progress_streak_leaderboard_info_title))
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(infoBody)
                    if (updatedText != null) {
                        Text(updatedText)
                    }
                }
            }
        )
    }
}

@Composable
private fun ProgressStreakLeaderboardReadyContent(
    uiState: ProgressStreakLeaderboardSectionUiState.Ready,
    onOpenProfile: (ProgressLeaderboardProfileIdentityUiState) -> Unit
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

    if (uiState.rows.isEmpty()) {
        Text(
            text = stringResource(id = R.string.progress_streak_leaderboard_empty),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium
        )
    } else {
        Text(
            text = pluralStringResource(
                id = R.plurals.progress_leaderboard_participant_count,
                count = uiState.participantCount,
                countFormatter.format(uiState.participantCount.toLong())
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall
        )

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            uiState.rows.forEachIndexed { index, row ->
                when (row) {
                    ProgressStreakLeaderboardRowUiState.Gap -> ProgressLeaderboardGapRow(
                        contentDescription = stringResource(
                            id = R.string.progress_leaderboard_gap_content_description
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(progressStreakLeaderboardGapRowTag(index = index))
                    )
                    is ProgressStreakLeaderboardRowUiState.Participant -> {
                        val streakDaysLabel = pluralStringResource(
                            id = R.plurals.progress_streak_leaderboard_day_count,
                            count = row.streakDays,
                            countFormatter.format(row.streakDays.toLong())
                        )
                        val displayName = if (row.isViewer) {
                            stringResource(id = R.string.progress_leaderboard_you)
                        } else {
                            row.displayName
                        }
                        val contentDescription = stringResource(
                            id = R.string.progress_leaderboard_profile_row_content_description,
                            displayName
                        )
                        ProgressLeaderboardParticipantRow(
                            rankLabel = countFormatter.format(row.rank.toLong()),
                            displayName = displayName,
                            metricLabel = streakDaysLabel,
                            isViewer = row.isViewer,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(progressStreakLeaderboardParticipantRowTag(rank = row.rank))
                                .semantics {
                                    this.contentDescription = contentDescription
                                }
                                .clickable {
                                    onOpenProfile(row.profileIdentity)
                                }
                        )
                    }
                }
            }
        }
    }
}
