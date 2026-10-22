package com.flashcardsopensourceapp.feature.settings.cloud.postAuth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val cloudPostAuthExistingButtonTagPrefix: String = "cloud_post_auth_existing_button:"
const val cloudPostAuthWorkspaceRowTag: String = "cloud_post_auth_workspace_row"
const val cloudPostAuthSelectedIndicatorTagPrefix: String = "cloud_post_auth_selected_indicator:"
const val cloudPostAuthCreateNewButtonTag: String = "cloud_post_auth_create_new_button"
const val cloudPostAuthNewWorkspaceNameFieldTag: String = "cloud_post_auth_new_workspace_name_field"
const val cloudPostAuthNewWorkspaceCreateButtonTag: String = "cloud_post_auth_new_workspace_create_button"

fun cloudPostAuthExistingButtonTag(workspaceId: String): String {
    return cloudPostAuthExistingButtonTagPrefix + workspaceId
}

fun cloudPostAuthSelectedIndicatorTag(workspaceId: String): String {
    return cloudPostAuthSelectedIndicatorTagPrefix + workspaceId
}

@Composable
fun CloudPostAuthRoute(
    uiState: CloudPostAuthUiState,
    onAutoContinue: () -> Unit,
    onSelectWorkspace: (CloudWorkspaceLinkSelection) -> Unit,
    onRetry: () -> Unit,
    onFailureAction: () -> Unit,
    onShowTechnicalDetails: (String, String) -> Unit,
    onBack: () -> Unit,
    canNavigateBack: Boolean,
    /** The failure action is a log out, which drains the analytics queue before it clears the
     *  credential, so the button it was pressed on has to report that wait. */
    isFailureActionInFlight: Boolean
) {
    LaunchedEffect(uiState.mode, uiState.pendingWorkspaceTitle) {
        if (uiState.mode == CloudPostAuthMode.READY_TO_AUTO_LINK) {
            onAutoContinue()
        }
    }

    val shouldBlockBack = canNavigateBack.not() ||
        uiState.mode == CloudPostAuthMode.PROCESSING
        || uiState.mode == CloudPostAuthMode.READY_TO_AUTO_LINK
    val isBackEnabled = canNavigateBack &&
        uiState.mode != CloudPostAuthMode.PROCESSING &&
        uiState.mode != CloudPostAuthMode.READY_TO_AUTO_LINK

    BackHandler(enabled = shouldBlockBack) {
        // Keep the post-auth cloud setup flow on screen until it either
        // finishes successfully or reaches an explicit failure state.
    }

    var isNameStepVisible by rememberSaveable { mutableStateOf(false) }
    var newWorkspaceName by rememberSaveable { mutableStateOf("") }
    val isNameStepShown = isNameStepVisible && uiState.mode == CloudPostAuthMode.CHOOSE_WORKSPACE

    // Registered after the blocking handler so back from the name step returns to the chooser.
    BackHandler(enabled = isNameStepShown) {
        isNameStepVisible = false
    }

    SettingsScreenScaffold(
        title = if (isNameStepShown) {
            stringResource(R.string.settings_current_workspace_new_title)
        } else {
            stringResource(R.string.settings_post_auth_title)
        },
        onBack = if (isNameStepShown) {
            { isNameStepVisible = false }
        } else {
            onBack
        },
        isBackEnabled = isNameStepShown || isBackEnabled
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            if (isNameStepShown) {
                item {
                    OutlinedTextField(
                        value = newWorkspaceName,
                        onValueChange = { name -> newWorkspaceName = name },
                        label = {
                            Text(stringResource(R.string.settings_workspace_name_label))
                        },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = cloudPostAuthNewWorkspaceNameFieldTag)
                    )
                }
                item {
                    Button(
                        onClick = {
                            onSelectWorkspace(
                                CloudWorkspaceLinkSelection.CreateNew(name = newWorkspaceName.trim())
                            )
                        },
                        enabled = newWorkspaceName.trim().isNotEmpty(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = cloudPostAuthNewWorkspaceCreateButtonTag)
                    ) {
                        Text(stringResource(R.string.settings_current_workspace_create_button))
                    }
                }
                return@LazyColumn
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        if (uiState.verifiedEmail != null) {
                            Text(
                                text = uiState.verifiedEmail,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        when (uiState.mode) {
                            CloudPostAuthMode.READY_TO_AUTO_LINK -> {
                                Text(
                                    if (uiState.isGuestLocalRecovery) {
                                        stringResource(
                                            R.string.settings_post_auth_prepare_guest_local_recovery_title
                                        )
                                    } else if (uiState.isGuestUpgrade) {
                                        stringResource(
                                            R.string.settings_post_auth_prepare_guest_title,
                                            uiState.pendingWorkspaceTitle
                                                ?: stringResource(R.string.settings_current_workspace_selected)
                                        )
                                    } else {
                                        stringResource(
                                            R.string.settings_post_auth_prepare_title,
                                            uiState.pendingWorkspaceTitle
                                                ?: stringResource(R.string.settings_current_workspace_selected)
                                        )
                                    }
                                )
                            }

                            CloudPostAuthMode.CHOOSE_WORKSPACE -> {
                                Text(
                                    if (uiState.isGuestUpgrade) {
                                        stringResource(R.string.settings_post_auth_choose_guest_workspace_body)
                                    } else {
                                        stringResource(R.string.settings_post_auth_choose_workspace_body)
                                    }
                                )
                            }

                            CloudPostAuthMode.PROCESSING -> {
                                CircularProgressIndicator()
                                Text(uiState.processingTitle)
                                Text(
                                    text = uiState.processingMessage,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            CloudPostAuthMode.FAILED -> {
                                Text(
                                    text = uiState.errorMessage,
                                    color = MaterialTheme.colorScheme.error
                                )
                                if (
                                    uiState.errorTechnicalDetails.isNullOrBlank().not() &&
                                    uiState.errorTechnicalDetailsReportId.isNullOrBlank().not()
                                ) {
                                    OutlinedButton(
                                        onClick = {
                                            onShowTechnicalDetails(
                                                uiState.errorTechnicalDetails.orEmpty(),
                                                uiState.errorTechnicalDetailsReportId.orEmpty()
                                            )
                                        },
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text(stringResource(R.string.settings_sign_in_error_show_details))
                                    }
                                }
                            }

                            CloudPostAuthMode.IDLE -> {
                                Text(
                                    text = stringResource(R.string.settings_post_auth_idle),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.CHOOSE_WORKSPACE) {
                items(uiState.workspaces, key = { item -> item.workspaceId }) { workspace ->
                    OutlinedButton(
                        onClick = {
                            if (workspace.isCreateNew) {
                                isNameStepVisible = true
                            } else {
                                onSelectWorkspace(
                                    CloudWorkspaceLinkSelection.Existing(workspaceId = workspace.workspaceId)
                                )
                            }
                        },
                        enabled = uiState.mode == CloudPostAuthMode.CHOOSE_WORKSPACE,
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(
                                if (workspace.isCreateNew) {
                                    Modifier.testTag(tag = cloudPostAuthCreateNewButtonTag)
                                } else {
                                    Modifier.testTag(tag = cloudPostAuthWorkspaceRowTag)
                                }
                            )
                            .then(
                                if (workspace.isCreateNew) {
                                    Modifier
                                } else {
                                    Modifier.testTag(
                                        tag = cloudPostAuthExistingButtonTag(
                                            workspaceId = workspace.workspaceId
                                        )
                                    )
                                }
                            )
                    ) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
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
                                        tag = cloudPostAuthSelectedIndicatorTag(
                                            workspaceId = workspace.workspaceId
                                        )
                                    )
                                } else {
                                    Modifier
                                }
                            )
                            Text(
                                text = workspace.subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.FAILED) {
                item {
                    Button(
                        onClick = onRetry,
                        enabled = uiState.canRetry && uiState.mode == CloudPostAuthMode.FAILED,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_retry))
                    }
                }
                if (uiState.canLogout) {
                    item {
                        OutlinedButton(
                            onClick = onFailureAction,
                            enabled = uiState.mode == CloudPostAuthMode.FAILED &&
                                isFailureActionInFlight.not(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (isFailureActionInFlight) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                            }
                            Text(uiState.failureActionLabel)
                        }
                    }
                }
            }
        }
    }
}
