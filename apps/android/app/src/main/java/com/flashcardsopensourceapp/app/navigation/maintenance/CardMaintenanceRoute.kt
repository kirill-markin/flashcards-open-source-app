package com.flashcardsopensourceapp.app.navigation.maintenance

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceKind
import com.flashcardsopensourceapp.feature.settings.R as SettingsR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CardMaintenanceRoute(
    kind: CloudCardMaintenanceKind,
    state: CardMaintenanceState,
    onConfirmationTextChange: (String) -> Unit,
    onExecute: () -> Unit,
    onRetryPreview: () -> Unit,
    onRetrySync: () -> Unit,
    onOpenAccountStatus: () -> Unit,
    onBack: () -> Unit
) {
    val isRemovingTag = kind == CloudCardMaintenanceKind.REMOVE_TAG
    val isApplying = state is CardMaintenanceState.Applying
    val isSyncing = (state as? CardMaintenanceState.RefreshNeeded)?.isSyncing == true
    val canGoBack = !isApplying && !isSyncing

    BackHandler { if (canGoBack) onBack() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(
                            if (isRemovingTag) R.string.card_maintenance_remove_title else R.string.card_maintenance_reset_title
                        )
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack, enabled = canGoBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.card_maintenance_back)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            when (state) {
                CardMaintenanceState.Loading -> {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.card_maintenance_loading))
                }
                CardMaintenanceState.Applying -> {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.card_maintenance_applying))
                }
                is CardMaintenanceState.Ready -> {
                    CardMaintenancePreviewContent(
                        kind = kind,
                        state = state,
                        onConfirmationTextChange = onConfirmationTextChange,
                        onExecute = onExecute
                    )
                }
                is CardMaintenanceState.Unavailable -> {
                    Text(
                        text = stringResource(state.reason),
                        color = MaterialTheme.colorScheme.error
                    )
                    if (state.isSyncBlocked) {
                        CardMaintenanceAccountStatusButton(onClick = onOpenAccountStatus)
                    } else if (state.canRetry) {
                        OutlinedButton(onClick = onRetryPreview) {
                            Text(stringResource(R.string.card_maintenance_retry_preview))
                        }
                    }
                }
                is CardMaintenanceState.RefreshNeeded -> {
                    val count = state.affectedCardsCount
                    if (count != null) {
                        Text(cardMaintenanceSuccess(kind = kind, count = count))
                    }
                    if (state.isSyncBlocked) {
                        Text(stringResource(SettingsR.string.settings_account_status_sync_blocked_body))
                        CardMaintenanceAccountStatusButton(onClick = onOpenAccountStatus)
                    } else {
                        Text(
                            stringResource(
                                if (count == null) {
                                    R.string.card_maintenance_execute_pending
                                } else {
                                    R.string.card_maintenance_refresh_failed
                                }
                            )
                        )
                        if (isSyncing) {
                            CircularProgressIndicator()
                        }
                        Button(onClick = onRetrySync, enabled = !isSyncing) {
                            Text(stringResource(R.string.card_maintenance_retry_sync))
                        }
                    }
                }
                is CardMaintenanceState.Finished -> {
                    Text(cardMaintenanceSuccess(kind = kind, count = state.affectedCardsCount))
                }
            }
        }
    }
}

@Composable
private fun CardMaintenanceAccountStatusButton(onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) {
        Text(stringResource(SettingsR.string.settings_account_status_title))
    }
}

@Composable
private fun CardMaintenancePreviewContent(
    kind: CloudCardMaintenanceKind,
    state: CardMaintenanceState.Ready,
    onConfirmationTextChange: (String) -> Unit,
    onExecute: () -> Unit
) {
    val preview = state.preview
    val notice = state.notice
    val isRemovingTag = kind == CloudCardMaintenanceKind.REMOVE_TAG
    val count = preview.affectedCardsCount
    Text(text = preview.targetName, style = MaterialTheme.typography.headlineSmall)

    if (notice != null) {
        Text(text = stringResource(notice), color = MaterialTheme.colorScheme.error)
    }
    if (preview.includesAllCards) {
        Text(stringResource(R.string.card_maintenance_entire_workspace))
    }
    if (isRemovingTag) {
        if (count > 0) {
            Text(pluralStringResource(R.plurals.card_maintenance_remove_preview, count, count))
            Text(stringResource(R.string.card_maintenance_keep_cards))
        } else {
            Text(stringResource(R.string.card_maintenance_empty_remove))
        }
        val deckCount = preview.affectedDecksCount
        Text(
            if (deckCount == 0) {
                stringResource(R.string.card_maintenance_no_decks)
            } else {
                pluralStringResource(R.plurals.card_maintenance_keep_deck_rules, deckCount, deckCount)
            }
        )
    } else if (count > 0) {
        Text(pluralStringResource(R.plurals.card_maintenance_reset_preview, count, count))
        if (kind != CloudCardMaintenanceKind.RESET_CARD) {
            Text(stringResource(R.string.card_maintenance_overlapping_scope))
        }
    } else {
        Text(stringResource(R.string.card_maintenance_empty_reset))
    }

    if (count <= 0) return
    Text(stringResource(R.string.card_maintenance_type_phrase))
    Text(text = preview.confirmationText, style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(
        value = state.confirmationText,
        onValueChange = onConfirmationTextChange,
        label = { Text(stringResource(R.string.card_maintenance_confirmation_label)) },
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("card_maintenance_confirmation")
    )
    Button(
        onClick = onExecute,
        enabled = state.confirmationText == preview.confirmationText,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.error,
            contentColor = MaterialTheme.colorScheme.onError
        ),
        modifier = Modifier.fillMaxWidth().testTag("card_maintenance_confirm")
    ) {
        Text(
            stringResource(
                if (isRemovingTag) R.string.card_maintenance_confirm_remove else R.string.card_maintenance_confirm_reset
            )
        )
    }
}

@Composable
internal fun cardMaintenanceSuccess(kind: CloudCardMaintenanceKind, count: Int): String {
    val resource = if (kind == CloudCardMaintenanceKind.REMOVE_TAG) {
        R.plurals.card_maintenance_remove_success
    } else {
        R.plurals.card_maintenance_reset_success
    }
    return pluralStringResource(resource, count, count)
}
