package com.flashcardsopensourceapp.feature.progress.sections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PersonAdd
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
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationDialog
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationUiState
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardProfileIdentityUiState
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardRowUiState
import com.flashcardsopensourceapp.feature.progress.ProgressLeaderboardSectionUiState
import com.flashcardsopensourceapp.feature.progress.R
import com.flashcardsopensourceapp.feature.friendinvite.R as FriendInviteR
import java.text.NumberFormat
import java.util.Locale

private const val leaderboardReservedGapRowCount: Int = 2
private const val millisecondsPerMinute: Long = 60_000L
private const val minutesPerHour: Int = 60

@Composable
internal fun LeaderboardSectionCard(
    uiState: ProgressLeaderboardSectionUiState,
    friendInvitationUiState: FriendInvitationUiState,
    onSelectWindow: (ProgressLeaderboardWindowKey) -> Unit,
    onOpenProfile: (ProgressLeaderboardProfileIdentityUiState) -> Unit,
    onCreateFriendInvitation: (String) -> Unit,
    onClearFriendInvitationFailure: () -> Unit,
    onOpenSignIn: () -> Unit,
    onOpenLeaderboardSettings: () -> Unit
) {
    var isInfoDialogVisible by rememberSaveable { mutableStateOf(false) }
    var isInviteDialogVisible by rememberSaveable { mutableStateOf(false) }

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

            FilledTonalButton(
                onClick = {
                    if (uiState == ProgressLeaderboardSectionUiState.SignInRequired) {
                        onOpenSignIn()
                    } else {
                        onClearFriendInvitationFailure()
                        isInviteDialogVisible = true
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(progressLeaderboardInviteButtonTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.PersonAdd,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.size(8.dp))
                Text(stringResource(id = FriendInviteR.string.friend_invite_button))
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
                    ProgressLeaderboardResolvedContent(
                        testTag = progressLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_leaderboard_sign_in_message),
                            buttonLabel = stringResource(id = R.string.progress_leaderboard_sign_in_button),
                            onButtonClick = onOpenSignIn
                        )
                    }
                }

                ProgressLeaderboardSectionUiState.ParticipationDisabled -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_leaderboard_participation_disabled_message),
                            buttonLabel = stringResource(id = R.string.progress_leaderboard_participation_disabled_button),
                            onButtonClick = onOpenLeaderboardSettings
                        )
                    }
                }

                ProgressLeaderboardSectionUiState.Offline -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_leaderboard_offline_message),
                            buttonLabel = null,
                            onButtonClick = null
                        )
                    }
                }

                ProgressLeaderboardSectionUiState.SnapshotUnavailable -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressLeaderboardResolvedContentTag
                    ) {
                        ProgressLeaderboardPlaceholder(
                            message = stringResource(id = R.string.progress_leaderboard_unavailable_message),
                            buttonLabel = null,
                            onButtonClick = null
                        )
                    }
                }

                is ProgressLeaderboardSectionUiState.Ready -> {
                    ProgressLeaderboardResolvedContent(
                        testTag = progressLeaderboardResolvedContentTag
                    ) {
                        LeaderboardReadyContent(
                            uiState = uiState,
                            onSelectWindow = onSelectWindow,
                            onOpenProfile = onOpenProfile
                        )
                    }
                }
            }
        }
    }

    if (isInfoDialogVisible) {
        val readyState = uiState as? ProgressLeaderboardSectionUiState.Ready
        val fallbackInfoBody = stringResource(id = R.string.progress_leaderboard_info_fallback_body)
        val infoBody = readyState?.metricDescription ?: fallbackInfoBody
        val selectedSnapshotGeneratedAtMillis = readyState?.selectedWindow?.snapshotGeneratedAtMillis
        val updatedText = selectedSnapshotGeneratedAtMillis?.let { snapshotGeneratedAtMillis ->
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
                Text(stringResource(id = R.string.progress_leaderboard_info_title))
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

    if (isInviteDialogVisible) {
        FriendInvitationDialog(
            uiState = friendInvitationUiState,
            displayNameFieldTag = progressLeaderboardInviteDisplayNameFieldTag,
            onCreateFriendInvitation = onCreateFriendInvitation,
            onClearFriendInvitationFailure = onClearFriendInvitationFailure,
            onDismiss = { isInviteDialogVisible = false }
        )
    }
}

@Composable
internal fun ProgressLeaderboardResolvedContent(
    testTag: String,
    content: @Composable () -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .testTag(testTag)
    ) {
        content()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaderboardReadyContent(
    uiState: ProgressLeaderboardSectionUiState.Ready,
    onSelectWindow: (ProgressLeaderboardWindowKey) -> Unit,
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
            selectedWindow.rows.forEachIndexed { index, row ->
                when (row) {
                    ProgressLeaderboardRowUiState.Gap -> ProgressLeaderboardGapRow(
                        contentDescription = stringResource(
                            id = R.string.progress_leaderboard_gap_content_description
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(progressLeaderboardGapRowTag(index = index))
                    )
                    is ProgressLeaderboardRowUiState.Participant -> {
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
                            metricLabel = countFormatter.format(row.qualifiedReviewCount.toLong()),
                            isViewer = row.isViewer,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(progressLeaderboardParticipantRowTag(rank = row.rank))
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

            val reservedRows = leaderboardReservedRows(
                rows = selectedWindow.rows,
                reservedRowCount = uiState.reservedRowCount
            )
            repeat(reservedRows.gapRowCount) {
                LeaderboardReservedGapRow()
            }
            repeat(reservedRows.participantRowCount) {
                LeaderboardReservedParticipantRow()
            }
        }
    }
}

internal data class ProgressLeaderboardElapsedTime(
    val hours: Int,
    val remainingMinutes: Int
)

internal fun progressLeaderboardElapsedTime(
    snapshotGeneratedAtMillis: Long,
    nowMillis: Long
): ProgressLeaderboardElapsedTime {
    val elapsedWholeMinutes: Long =
        maxOf(0L, nowMillis - snapshotGeneratedAtMillis) / millisecondsPerMinute
    require(elapsedWholeMinutes <= Int.MAX_VALUE) {
        "Leaderboard snapshot elapsed freshness is too large to format: " +
            "snapshotGeneratedAtMillis=$snapshotGeneratedAtMillis, nowMillis=$nowMillis, " +
            "elapsedWholeMinutes=$elapsedWholeMinutes"
    }
    val elapsedWholeMinutesInt: Int = elapsedWholeMinutes.toInt()

    return ProgressLeaderboardElapsedTime(
        hours = elapsedWholeMinutesInt / minutesPerHour,
        remainingMinutes = elapsedWholeMinutesInt % minutesPerHour
    )
}

@Composable
internal fun progressLeaderboardUpdatedLabel(
    elapsedTime: ProgressLeaderboardElapsedTime
): String {
    if (elapsedTime.hours == 0) {
        return pluralStringResource(
            id = R.plurals.progress_leaderboard_updated_minute_label,
            count = elapsedTime.remainingMinutes,
            elapsedTime.remainingMinutes
        )
    }

    if (elapsedTime.remainingMinutes == 0) {
        return pluralStringResource(
            id = R.plurals.progress_leaderboard_updated_hour_label,
            count = elapsedTime.hours,
            elapsedTime.hours
        )
    }

    val remainingMinutesLabel: String = pluralStringResource(
        id = R.plurals.progress_leaderboard_elapsed_minute_count,
        count = elapsedTime.remainingMinutes,
        elapsedTime.remainingMinutes
    )
    return pluralStringResource(
        id = R.plurals.progress_leaderboard_updated_hour_minute_label,
        count = elapsedTime.hours,
        elapsedTime.hours,
        remainingMinutesLabel
    )
}

private data class LeaderboardReservedRows(
    val participantRowCount: Int,
    val gapRowCount: Int
)

private fun leaderboardReservedRows(
    rows: List<ProgressLeaderboardRowUiState>,
    reservedRowCount: Int
): LeaderboardReservedRows {
    val missingRowCount = maxOf(0, reservedRowCount - rows.size)
    val visibleGapRowCount = rows.count { row ->
        row == ProgressLeaderboardRowUiState.Gap
    }
    val missingGapRowCount = maxOf(0, leaderboardReservedGapRowCount - visibleGapRowCount)
    val gapRowCount = minOf(missingGapRowCount, missingRowCount)

    return LeaderboardReservedRows(
        participantRowCount = missingRowCount - gapRowCount,
        gapRowCount = gapRowCount
    )
}

@Composable
internal fun ProgressLeaderboardParticipantRow(
    rankLabel: String,
    displayName: String,
    metricLabel: String,
    isViewer: Boolean,
    modifier: Modifier
) {
    val emphasisColor = MaterialTheme.colorScheme.primary
    val rowColor = if (isViewer) emphasisColor else MaterialTheme.colorScheme.onSurface
    val rowWeight = if (isViewer) FontWeight.SemiBold else null

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier
    ) {
        Text(
            text = stringResource(id = R.string.progress_leaderboard_rank_label, rankLabel),
            color = if (isViewer) emphasisColor else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight
        )
        Text(
            text = displayName,
            color = rowColor,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = metricLabel,
            color = rowColor,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = rowWeight,
            textAlign = TextAlign.End
        )
    }
}

@Composable
private fun LeaderboardReservedParticipantRow() {
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
private fun LeaderboardReservedGapRow() {
    Text(
        text = "⋯",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .alpha(0f)
            .clearAndSetSemantics {}
    )
}

@Composable
internal fun ProgressLeaderboardGapRow(
    contentDescription: String,
    modifier: Modifier
) {
    Text(
        text = "⋯",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clearAndSetSemantics {
                this.contentDescription = contentDescription
            }
    )
}

@Composable
internal fun ProgressLeaderboardPlaceholder(
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
