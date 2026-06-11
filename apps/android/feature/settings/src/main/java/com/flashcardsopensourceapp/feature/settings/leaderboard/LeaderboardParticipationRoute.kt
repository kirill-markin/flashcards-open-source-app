package com.flashcardsopensourceapp.feature.settings.leaderboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsLeaderboardParticipationToggleTag
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val leaderboardParticipationScreenTag: String = "leaderboard_participation_screen"

@Composable
fun LeaderboardParticipationRoute(
    uiState: LeaderboardParticipationUiState,
    onUpdateLeaderboardParticipation: (Boolean) -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_leaderboard_participation_title),
        onBack = onBack,
        isBackEnabled = uiState.isUpdating.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = leaderboardParticipationScreenTag)
        ) {
            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    if (uiState.canManageLeaderboardParticipation) {
                        val leaderboardParticipationEnabled = uiState.leaderboardParticipationEnabled
                        if (leaderboardParticipationEnabled == null) {
                            ListItem(
                                headlineContent = {
                                    Text(stringResource(R.string.settings_leaderboard_participation_toggle_title))
                                },
                                supportingContent = {
                                    Text(stringResource(R.string.settings_leaderboard_participation_toggle_body))
                                },
                                trailingContent = {
                                    CircularProgressIndicator()
                                }
                            )
                        } else {
                            ListItem(
                                headlineContent = {
                                    Text(stringResource(R.string.settings_leaderboard_participation_toggle_title))
                                },
                                supportingContent = {
                                    Text(stringResource(R.string.settings_leaderboard_participation_toggle_body))
                                },
                                trailingContent = {
                                    Switch(
                                        checked = leaderboardParticipationEnabled,
                                        onCheckedChange = onUpdateLeaderboardParticipation,
                                        enabled = uiState.isUpdating.not(),
                                        modifier = Modifier.testTag(tag = settingsLeaderboardParticipationToggleTag)
                                    )
                                }
                            )
                        }
                    } else {
                        Text(
                            text = stringResource(R.string.settings_leaderboard_participation_sign_in_required),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }
        }
    }
}
