package com.flashcardsopensourceapp.feature.settings.workspace.current

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SheetState
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val currentWorkspaceChangeActionTag: String = "current_workspace_change_action"
const val currentWorkspaceRenameActionTag: String = "current_workspace_rename_action"
const val currentWorkspaceChangeSheetTag: String = "current_workspace_change_sheet"
const val currentWorkspaceChangeSheetListTag: String = "current_workspace_change_sheet_list"
const val currentWorkspaceRenameDialogTag: String = "current_workspace_rename_dialog"
const val currentWorkspaceCreateButtonTag: String = "current_workspace_create_button"
const val currentWorkspaceExistingRowTag: String = "current_workspace_existing_row"
const val currentWorkspaceSelectedSummaryTag: String = "current_workspace_selected_summary"
const val currentWorkspaceExistingButtonTagPrefix: String = "current_workspace_existing_button:"
const val currentWorkspaceSelectedIndicatorTagPrefix: String = "current_workspace_selected_indicator:"
const val currentWorkspaceListTag: String = "current_workspace_list"
const val currentWorkspaceNameTag: String = "current_workspace_name"
const val currentWorkspaceErrorMessageTag: String = "current_workspace_error_message"
const val currentWorkspaceOperationMessageTag: String = "current_workspace_operation_message"
const val currentWorkspaceLoadingStateTag: String = "current_workspace_loading_state"
const val currentWorkspaceReloadButtonTag: String = "current_workspace_reload_button"
const val currentWorkspaceNameFieldTag: String = "current_workspace_name_field"
const val currentWorkspaceSaveNameButtonTag: String = "current_workspace_save_name_button"

fun currentWorkspaceExistingButtonTag(workspaceId: String): String {
    return currentWorkspaceExistingButtonTagPrefix + workspaceId
}

fun currentWorkspaceSelectedIndicatorTag(workspaceId: String): String {
    return currentWorkspaceSelectedIndicatorTagPrefix + workspaceId
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CurrentWorkspaceRoute(
    uiState: CurrentWorkspaceUiState,
    onReload: () -> Unit,
    onSwitchToExistingWorkspace: (String) -> Unit,
    onCreateWorkspace: () -> Unit,
    onWorkspaceNameChange: (String) -> Unit,
    onSaveWorkspaceName: () -> String,
    onOpenSignIn: () -> Unit,
    onRetryLastWorkspaceAction: () -> Unit,
    onBack: () -> Unit
) {
    var isChangeSheetVisible by rememberSaveable { mutableStateOf(false) }
    var isRenameDialogVisible by rememberSaveable { mutableStateOf(false) }
    var hasSubmittedWorkspaceAction by rememberSaveable { mutableStateOf(false) }
    var pendingRenameSubmissionId: String? by rememberSaveable {
        mutableStateOf<String?>(null)
    }

    LaunchedEffect(
        uiState.isLinked,
        uiState.isLinkingReady,
        uiState.workspaceLoadState
    ) {
        if (
            (uiState.isLinked || uiState.isLinkingReady)
            && uiState.workspaceLoadState == CurrentWorkspaceLoadState.Loading
        ) {
            onReload()
        }
    }

    LaunchedEffect(
        uiState.operation,
        uiState.errorMessage
    ) {
        if (
            isChangeSheetVisible
            && hasSubmittedWorkspaceAction
            && uiState.operation == CurrentWorkspaceOperation.IDLE
        ) {
            if (uiState.errorMessage.isEmpty()) {
                isChangeSheetVisible = false
            }
            hasSubmittedWorkspaceAction = false
        }
    }

    LaunchedEffect(
        uiState.renameCompletion,
        pendingRenameSubmissionId
    ) {
        val completion = uiState.renameCompletion
        if (
            completion != null
            && completion.submissionId == pendingRenameSubmissionId
        ) {
            if (completion.result == CurrentWorkspaceRenameResult.SUCCEEDED) {
                isRenameDialogVisible = false
            }
            pendingRenameSubmissionId = null
        }
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_root_current_workspace_title),
        onBack = onBack,
        isBackEnabled = uiState.isSwitching.not() && uiState.isSavingName.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = currentWorkspaceListTag)
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_current_workspace_current_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = uiState.currentWorkspaceName,
                            modifier = Modifier.testTag(tag = currentWorkspaceNameTag)
                        )
                        Text(
                            text = stringResource(
                                R.string.settings_account_status_cloud_status_label
                            ) + ": " + uiState.cloudStatusTitle,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (uiState.linkedEmail != null) {
                            Text(
                                text = uiState.linkedEmail,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        WorkspaceOperationMessage(
                            uiState = uiState,
                            modifier = Modifier.testTag(tag = currentWorkspaceOperationMessageTag)
                        )
                    }
                }
            }

            if (
                uiState.errorMessage.isNotEmpty()
                && uiState.operation == CurrentWorkspaceOperation.IDLE
                && isChangeSheetVisible.not()
                && isRenameDialogVisible.not()
            ) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        WorkspaceErrorMessage(
                            errorMessage = uiState.errorMessage,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            if (uiState.successMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.successMessage,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        if (
                            uiState.isInitialized
                            && uiState.isLinked.not()
                            && uiState.isLinkingReady.not()
                        ) {
                            Text(
                                text = if (uiState.isGuest) {
                                    stringResource(R.string.settings_current_workspace_load_guest_message)
                                } else {
                                    stringResource(R.string.settings_current_workspace_load_sign_in_message)
                                },
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Button(
                            onClick = {
                                if (uiState.isLinked || uiState.isLinkingReady) {
                                    isChangeSheetVisible = true
                                } else {
                                    onOpenSignIn()
                                }
                            },
                            enabled = uiState.isInitialized &&
                                uiState.isSwitching.not() &&
                                uiState.isSavingName.not(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = currentWorkspaceChangeActionTag)
                        ) {
                            Text(stringResource(R.string.settings_current_workspace_change_action))
                        }
                        OutlinedButton(
                            onClick = {
                                when {
                                    uiState.isLinked -> {
                                        onWorkspaceNameChange(uiState.currentWorkspaceName)
                                        pendingRenameSubmissionId = null
                                        isRenameDialogVisible = true
                                    }
                                    uiState.isLinkingReady -> {
                                        isChangeSheetVisible = true
                                    }
                                    else -> {
                                        onOpenSignIn()
                                    }
                                }
                            },
                            enabled = uiState.isInitialized &&
                                uiState.isSwitching.not() &&
                                uiState.isSavingName.not(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = currentWorkspaceRenameActionTag)
                        ) {
                            Text(stringResource(R.string.settings_current_workspace_rename_action))
                        }
                    }
                }
            }
        }
    }

    if (isChangeSheetVisible) {
        CurrentWorkspaceChangeSheet(
            uiState = uiState,
            onReload = onReload,
            onSwitchToExistingWorkspace = { workspaceId ->
                hasSubmittedWorkspaceAction = true
                onSwitchToExistingWorkspace(workspaceId)
            },
            onCreateWorkspace = {
                hasSubmittedWorkspaceAction = true
                onCreateWorkspace()
            },
            onOpenSignIn = onOpenSignIn,
            onRetryLastWorkspaceAction = {
                hasSubmittedWorkspaceAction = true
                onRetryLastWorkspaceAction()
            },
            onDismiss = {
                if (uiState.isSwitching.not()) {
                    isChangeSheetVisible = false
                    hasSubmittedWorkspaceAction = false
                }
            }
        )
    }

    if (isRenameDialogVisible) {
        CurrentWorkspaceRenameDialog(
            uiState = uiState,
            onWorkspaceNameChange = onWorkspaceNameChange,
            onSaveWorkspaceName = {
                pendingRenameSubmissionId = onSaveWorkspaceName()
            },
            onDismiss = {
                if (uiState.isSavingName.not()) {
                    onWorkspaceNameChange(uiState.currentWorkspaceName)
                    pendingRenameSubmissionId = null
                    isRenameDialogVisible = false
                }
            }
        )
    }
}

@Composable
private fun WorkspaceOperationMessage(
    uiState: CurrentWorkspaceUiState,
    modifier: Modifier
) {
    if (uiState.pendingWorkspaceTitle == null) {
        return
    }
    Text(
        text = when (uiState.operation) {
            CurrentWorkspaceOperation.SWITCHING -> stringResource(
                R.string.settings_current_workspace_switching,
                uiState.pendingWorkspaceTitle
            )
            CurrentWorkspaceOperation.SYNCING -> stringResource(
                R.string.settings_current_workspace_syncing,
                uiState.pendingWorkspaceTitle
            )
            CurrentWorkspaceOperation.IDLE,
            CurrentWorkspaceOperation.LOADING -> ""
        },
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier
    )
}

@Composable
private fun WorkspaceErrorMessage(
    errorMessage: String,
    modifier: Modifier
) {
    Text(
        text = errorMessage,
        color = MaterialTheme.colorScheme.error,
        modifier = modifier.testTag(tag = currentWorkspaceErrorMessageTag)
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CurrentWorkspaceChangeSheet(
    uiState: CurrentWorkspaceUiState,
    onReload: () -> Unit,
    onSwitchToExistingWorkspace: (String) -> Unit,
    onCreateWorkspace: () -> Unit,
    onOpenSignIn: () -> Unit,
    onRetryLastWorkspaceAction: () -> Unit,
    onDismiss: () -> Unit
) {
    val isSwitching: Boolean by rememberUpdatedState(newValue = uiState.isSwitching)
    val sheetState: SheetState = rememberModalBottomSheetState(
        confirmValueChange = { nextValue: SheetValue ->
            nextValue != SheetValue.Hidden || isSwitching.not()
        }
    )
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = Modifier.testTag(tag = currentWorkspaceChangeSheetTag)
    ) {
        LazyColumn(
            contentPadding = PaddingValues(start = 24.dp, end = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .testTag(tag = currentWorkspaceChangeSheetListTag)
        ) {
            item {
                Text(
                    text = stringResource(R.string.settings_current_workspace_change_sheet_title),
                    style = MaterialTheme.typography.titleLarge
                )
            }

            if (uiState.pendingWorkspaceTitle != null) {
                item {
                    WorkspaceOperationMessage(
                        uiState = uiState,
                        modifier = Modifier
                    )
                }
            }

            when {
                uiState.isLinked.not() && uiState.isLinkingReady.not() -> {
                    item {
                        Text(
                            text = if (uiState.isGuest) {
                                stringResource(R.string.settings_current_workspace_load_guest_message)
                            } else {
                                stringResource(R.string.settings_current_workspace_load_sign_in_message)
                            },
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    item {
                        Button(
                            onClick = onOpenSignIn,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(stringResource(R.string.settings_account_status_sign_in_button))
                        }
                    }
                }

                uiState.workspaceLoadState == CurrentWorkspaceLoadState.Loading -> {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(
                                modifier = Modifier.testTag(tag = currentWorkspaceLoadingStateTag)
                            )
                            Text(stringResource(R.string.settings_loading))
                        }
                    }
                }

                uiState.workspaceLoadState == CurrentWorkspaceLoadState.Failed -> {
                    if (uiState.errorMessage.isNotEmpty()) {
                        item {
                            WorkspaceErrorMessage(
                                errorMessage = uiState.errorMessage,
                                modifier = Modifier
                            )
                        }
                    }
                    item {
                        Button(
                            onClick = onReload,
                            enabled = uiState.isSwitching.not(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = currentWorkspaceReloadButtonTag)
                        ) {
                            Text(stringResource(R.string.settings_reload))
                        }
                    }
                }

                else -> {
                    val existingWorkspaces = uiState.workspaces.filterNot { workspace ->
                        workspace.isCreateNew
                    }
                    if (existingWorkspaces.isNotEmpty()) {
                        item(key = "existing-workspaces") {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .selectableGroup()
                            ) {
                                existingWorkspaces.forEach { workspace ->
                                    val isSelectionEnabled = workspace.isSelected.not() &&
                                        uiState.isSwitching.not()
                                    Column(
                                        modifier = Modifier.testTag(
                                            tag = currentWorkspaceExistingRowTag
                                        )
                                    ) {
                                        ListItem(
                                            headlineContent = {
                                                Text(
                                                    text = if (workspace.isSelected) {
                                                        stringResource(
                                                            R.string.settings_post_auth_current_workspace_suffix,
                                                            workspace.title
                                                        )
                                                    } else {
                                                        workspace.title
                                                    },
                                                    modifier = if (workspace.isSelected) {
                                                        Modifier.testTag(
                                                            tag = currentWorkspaceSelectedSummaryTag
                                                        )
                                                    } else {
                                                        Modifier
                                                    }
                                                )
                                            },
                                            supportingContent = {
                                                Text(text = workspace.subtitle)
                                            },
                                            leadingContent = {
                                                RadioButton(
                                                    selected = workspace.isSelected,
                                                    onClick = null,
                                                    modifier = if (workspace.isSelected) {
                                                        Modifier.testTag(
                                                            tag = currentWorkspaceSelectedIndicatorTag(
                                                                workspaceId = workspace.workspaceId
                                                            )
                                                        )
                                                    } else {
                                                        Modifier
                                                    }
                                                )
                                            },
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .testTag(
                                                    tag = currentWorkspaceExistingButtonTag(
                                                        workspaceId = workspace.workspaceId
                                                    )
                                                )
                                                .selectable(
                                                    selected = workspace.isSelected,
                                                    enabled = isSelectionEnabled,
                                                    role = Role.RadioButton,
                                                    onClick = {
                                                        onSwitchToExistingWorkspace(
                                                            workspace.workspaceId
                                                        )
                                                    }
                                                )
                                        )
                                    }
                                }
                            }
                        }
                    }
                    val createWorkspace = uiState.workspaces.firstOrNull { workspace ->
                        workspace.isCreateNew
                    }
                    if (createWorkspace != null) {
                        item(key = createWorkspace.workspaceId) {
                            OutlinedButton(
                                onClick = onCreateWorkspace,
                                enabled = uiState.isSwitching.not(),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag(tag = currentWorkspaceCreateButtonTag)
                            ) {
                                Column(
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(text = createWorkspace.title)
                                    Text(
                                        text = createWorkspace.subtitle,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                    if (uiState.errorMessage.isNotEmpty()) {
                        item {
                            WorkspaceErrorMessage(
                                errorMessage = uiState.errorMessage,
                                modifier = Modifier
                            )
                        }
                    }
                    if (uiState.canRetryLastWorkspaceAction && uiState.errorMessage.isNotEmpty()) {
                        item {
                            OutlinedButton(
                                onClick = onRetryLastWorkspaceAction,
                                enabled = uiState.isSwitching.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(stringResource(R.string.settings_retry))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CurrentWorkspaceRenameDialog(
    uiState: CurrentWorkspaceUiState,
    onWorkspaceNameChange: (String) -> Unit,
    onSaveWorkspaceName: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = onSaveWorkspaceName,
                enabled = uiState.isSavingName.not() &&
                    uiState.isSwitching.not() &&
                    uiState.workspaceNameDraft.trim().isNotEmpty() &&
                    uiState.workspaceNameDraft.trim() != uiState.currentWorkspaceName,
                modifier = Modifier.testTag(tag = currentWorkspaceSaveNameButtonTag)
            ) {
                Text(
                    if (uiState.isSavingName) {
                        stringResource(R.string.settings_saving)
                    } else {
                        stringResource(R.string.settings_workspace_save_name_button)
                    }
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = uiState.isSavingName.not()
            ) {
                Text(stringResource(R.string.settings_cancel))
            }
        },
        title = {
            Text(stringResource(R.string.settings_current_workspace_rename_dialog_title))
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = uiState.workspaceNameDraft,
                    onValueChange = onWorkspaceNameChange,
                    enabled = uiState.isSavingName.not() && uiState.isSwitching.not(),
                    label = {
                        Text(stringResource(R.string.settings_workspace_name_label))
                    },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = currentWorkspaceNameFieldTag)
                )
                if (uiState.errorMessage.isNotEmpty()) {
                    WorkspaceErrorMessage(
                        errorMessage = uiState.errorMessage,
                        modifier = Modifier
                    )
                }
            }
        },
        modifier = Modifier.testTag(tag = currentWorkspaceRenameDialogTag)
    )
}
