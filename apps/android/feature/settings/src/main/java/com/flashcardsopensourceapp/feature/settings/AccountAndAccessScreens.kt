package com.flashcardsopensourceapp.feature.settings

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.outlined.SaveAlt
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.core.ui.components.SectionTitle
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import kotlinx.coroutines.launch
import java.time.LocalDate

@Composable
fun AccountRoute(
    workspaceName: String,
    onOpenStatus: () -> Unit,
    onOpenLegalSupport: () -> Unit,
    onOpenOpenSource: () -> Unit,
    onOpenAdvanced: () -> Unit,
    onOpenAgentConnections: () -> Unit,
    onOpenDangerZone: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Account Settings",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Account status")
                        },
                        supportingContent = {
                            Text("Workspace: $workspaceName")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.PersonOutline,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenStatus)
                    )
                }
            }

            item {
                SectionTitle(text = "Support")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Legal & support")
                        },
                        supportingContent = {
                            Text("Privacy, terms, support, and contact")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Handshake,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenLegalSupport)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Open source")
                        },
                        supportingContent = {
                            Text("GitHub repository and self-hosting direction")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Code,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenOpenSource)
                    )
                }
            }

            item {
                SectionTitle(text = "Advanced")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Advanced")
                        },
                        supportingContent = {
                            Text("Server configuration")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.SettingsEthernet,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenAdvanced)
                    )
                }
            }

            item {
                SectionTitle(text = "Connections")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Agent connections")
                        },
                        supportingContent = {
                            Text("Review and revoke long-lived bot connections")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Link,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenAgentConnections)
                    )
                }
            }

            item {
                SectionTitle(text = "Danger zone")
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Danger zone")
                        },
                        supportingContent = {
                            Text("Delete account")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.WarningAmber,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenDangerZone)
                    )
                }
            }
        }
    }
}

@Composable
fun AccountStatusRoute(
    uiState: AccountStatusUiState,
    onOpenSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onRequestLogout: () -> Unit,
    onDismissLogoutConfirmation: () -> Unit,
    onConfirmLogout: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Account Status",
        onBack = onBack,
        isBackEnabled = uiState.isSubmitting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
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
                    ListItem(
                        headlineContent = {
                            Text("Cloud status")
                        },
                        supportingContent = {
                            Text(uiState.cloudStatusTitle)
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.LockOpen,
                                contentDescription = null
                            )
                        }
                    )
                }
            }

            item {
                DeviceInfoCard(
                    title = "Account",
                    rows = buildList {
                        add("Workspace" to uiState.workspaceName)
                        add("Device ID" to uiState.deviceId)
                        add("Sync" to uiState.syncStatusText)
                        add("Last successful sync" to uiState.lastSuccessfulSync)
                        if (uiState.linkedEmail != null) {
                            add("Linked email" to uiState.linkedEmail)
                        }
                    }
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Actions",
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (uiState.isGuest) {
                            Text(
                                text = "Guest AI is active on this device. Create an account or log in to upgrade it into a linked cloud account.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (uiState.isLinked || uiState.isLinkingReady.not()) {
                            Button(
                                onClick = onOpenSignIn,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    when {
                                        uiState.isLinked -> "Switch account"
                                        uiState.isGuest -> "Sign in or sign up"
                                        else -> "Sign in or sign up"
                                    }
                                )
                            }
                        }
                        if (uiState.isLinked) {
                            Button(
                                onClick = onSyncNow,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (uiState.isSubmitting) "Syncing..." else "Sync now")
                            }
                            OutlinedButton(
                                onClick = onRequestLogout,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Log out")
                            }
                        }
                    }
                }
            }
        }
    }

    if (uiState.showLogoutConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isSubmitting.not()) {
                    onDismissLogoutConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onConfirmLogout,
                    enabled = uiState.isSubmitting.not()
                ) {
                    Text(if (uiState.isSubmitting) "Logging out..." else "Log out")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissLogoutConfirmation,
                    enabled = uiState.isSubmitting.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Log out and clear this device?")
            },
            text = {
                Text("All local workspaces and synced data will be removed from this device.")
            }
        )
    }
}

@Composable
fun CurrentWorkspaceRoute(
    uiState: CurrentWorkspaceUiState,
    onReload: () -> Unit,
    onSwitchToExistingWorkspace: (String) -> Unit,
    onCreateWorkspace: () -> Unit,
    onOpenSignIn: () -> Unit,
    onRetryLastWorkspaceAction: () -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.isLinked, uiState.workspaces.isEmpty(), uiState.isLoading) {
        if (uiState.isLinked && uiState.workspaces.isEmpty() && uiState.isLoading.not()) {
            onReload()
        }
    }

    SettingsScreenScaffold(
        title = "Current Workspace",
        onBack = onBack,
        isBackEnabled = uiState.isSwitching.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Current workspace",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(uiState.currentWorkspaceName)
                    Text(
                        text = "Cloud status: ${uiState.cloudStatusTitle}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (uiState.linkedEmail != null) {
                        Text(
                            text = uiState.linkedEmail,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (uiState.pendingWorkspaceTitle != null) {
                        Text(
                            text = when (uiState.operation) {
                                CurrentWorkspaceOperation.SWITCHING -> "Switching to ${uiState.pendingWorkspaceTitle}..."
                                CurrentWorkspaceOperation.SYNCING -> "Syncing ${uiState.pendingWorkspaceTitle}..."
                                CurrentWorkspaceOperation.IDLE,
                                CurrentWorkspaceOperation.LOADING -> ""
                            },
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

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
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Linked workspaces",
                        style = MaterialTheme.typography.titleMedium
                    )
                    when {
                        uiState.isLinked.not() && uiState.isLinkingReady.not() -> {
                            Text(
                                text = if (uiState.isGuest) {
                                    "Create an account or log in to upgrade Guest AI before managing linked workspaces."
                                } else {
                                    "Sign in first to load linked cloud workspaces."
                                },
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Button(
                                onClick = onOpenSignIn,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (uiState.isGuest) "Create account or Log in" else "Sign in")
                            }
                        }

                        uiState.isLoading -> {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                CircularProgressIndicator()
                                Text("Loading linked workspaces...")
                            }
                        }

                        uiState.workspaces.isEmpty() -> {
                            Button(
                                onClick = onReload,
                                enabled = uiState.isSwitching.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Load linked workspaces")
                            }
                        }

                        else -> {
                            uiState.workspaces.forEach { workspace ->
                                OutlinedButton(
                                    onClick = {
                                        if (workspace.isCreateNew) {
                                            onCreateWorkspace()
                                        } else {
                                            onSwitchToExistingWorkspace(workspace.workspaceId)
                                        }
                                    },
                                    enabled = uiState.isSwitching.not(),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(
                                        if (workspace.isSelected) {
                                            "${workspace.title} (Current)"
                                        } else {
                                            workspace.title
                                        }
                                    )
                                }
                            }
                            if (uiState.canRetryLastWorkspaceAction && uiState.errorMessage.isNotEmpty()) {
                                OutlinedButton(
                                    onClick = onRetryLastWorkspaceAction,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Retry last workspace action")
                                }
                            }
                        }
                    }
                }
            }
        }
        }
    }
}

@Composable
fun AccountAdvancedRoute(
    onOpenServer: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Advanced",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Server")
                        },
                        supportingContent = {
                            Text("Official or self-hosted server configuration")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.SettingsEthernet,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenServer)
                    )
                }
            }
        }
    }
}

@Composable
fun ServerSettingsRoute(
    uiState: ServerSettingsUiState,
    onCustomOriginChange: (String) -> Unit,
    onValidateCustomServer: () -> Unit,
    onApplyPreviewConfiguration: () -> Unit,
    onResetToOfficialServer: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Server",
        onBack = onBack,
        isBackEnabled = uiState.isApplying.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
        item {
            DeviceInfoCard(
                title = "Current server",
                rows = listOf(
                    "Mode" to uiState.modeTitle,
                    "API" to uiState.apiBaseUrl,
                    "Auth" to uiState.authBaseUrl
                )
            )
        }

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
            OutlinedTextField(
                value = uiState.customOrigin,
                onValueChange = onCustomOriginChange,
                label = {
                    Text("Custom origin")
                },
                supportingText = {
                    Text("Use a base HTTPS URL like https://example.com")
                },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (uiState.previewApiBaseUrl != null && uiState.previewAuthBaseUrl != null) {
            item {
                DeviceInfoCard(
                    title = "Preview",
                    rows = listOf(
                        "API" to uiState.previewApiBaseUrl,
                        "Auth" to uiState.previewAuthBaseUrl
                    )
                )
            }
        }

        item {
            Button(
                onClick = onValidateCustomServer,
                enabled = uiState.isApplying.not(),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(if (uiState.isApplying) "Validating..." else "Validate custom server")
            }
        }

        item {
            Button(
                onClick = onApplyPreviewConfiguration,
                enabled = uiState.previewApiBaseUrl != null && uiState.isApplying.not(),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Apply custom server")
            }
        }

        item {
            OutlinedButton(
                onClick = onResetToOfficialServer,
                enabled = uiState.isApplying.not(),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Reset to official server")
            }
        }
        }
    }
}

@Composable
fun CloudSignInEmailRoute(
    uiState: CloudSignInUiState,
    onEmailChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Sign in",
        onBack = onBack,
        isBackEnabled = uiState.isSendingCode.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.isGuestUpgrade) {
                            "Sign in with email to upgrade this Guest AI session into a linked cloud account."
                        } else {
                            "Sign in with email to link this Android device to your cloud workspace."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

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
                OutlinedTextField(
                    value = uiState.email,
                    onValueChange = onEmailChange,
                    label = {
                        Text("Email")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Button(
                    onClick = onSendCode,
                    enabled = uiState.isSendingCode.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isSendingCode) "Sending..." else "Send one-time code")
                }
            }
        }
    }
}

@Composable
fun CloudSignInCodeRoute(
    uiState: CloudSignInUiState,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Verify code",
        onBack = onBack,
        isBackEnabled = uiState.isVerifyingCode.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.isGuestUpgrade) {
                            "Enter the one-time code sent to ${uiState.challengeEmail ?: "your email"} to finish upgrading Guest AI."
                        } else {
                            "Enter the one-time code sent to ${uiState.challengeEmail ?: "your email"}."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

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
                OutlinedTextField(
                    value = uiState.code,
                    onValueChange = onCodeChange,
                    label = {
                        Text("One-time code")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Button(
                    onClick = onVerifyCode,
                    enabled = uiState.isVerifyingCode.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isVerifyingCode) "Verifying..." else "Verify code")
                }
            }
        }
    }
}

@Composable
fun CloudPostAuthRoute(
    uiState: CloudPostAuthUiState,
    onAutoContinue: () -> Unit,
    onSelectWorkspace: (CloudWorkspaceLinkSelection) -> Unit,
    onRetry: () -> Unit,
    onLogout: () -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.mode, uiState.pendingWorkspaceTitle) {
        if (uiState.mode == CloudPostAuthMode.READY_TO_AUTO_LINK) {
            onAutoContinue()
        }
    }

    val isBackEnabled = uiState.mode != CloudPostAuthMode.PROCESSING
        && uiState.mode != CloudPostAuthMode.READY_TO_AUTO_LINK

    SettingsScreenScaffold(
        title = "Cloud sync",
        onBack = onBack,
        isBackEnabled = isBackEnabled
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
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
                                    if (uiState.isGuestUpgrade) {
                                        "Preparing to upgrade Guest AI into ${uiState.pendingWorkspaceTitle ?: "your workspace"}..."
                                    } else {
                                        "Preparing ${uiState.pendingWorkspaceTitle ?: "your workspace"}..."
                                    }
                                )
                            }

                            CloudPostAuthMode.CHOOSE_WORKSPACE -> {
                                Text(
                                    if (uiState.isGuestUpgrade) {
                                        "Choose the linked workspace that should receive this Guest AI session, or create a new one."
                                    } else {
                                        "Choose a linked workspace to open on this Android device, or create a new one."
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
                            }

                            CloudPostAuthMode.IDLE -> {
                                Text(
                                    text = "Cloud account setup is idle.",
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
                                onSelectWorkspace(CloudWorkspaceLinkSelection.CreateNew)
                            } else {
                                onSelectWorkspace(
                                    CloudWorkspaceLinkSelection.Existing(workspaceId = workspace.workspaceId)
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(workspace.title)
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.FAILED) {
                item {
                    Button(
                        onClick = onRetry,
                        enabled = uiState.canRetry,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Retry")
                    }
                }
                item {
                    OutlinedButton(
                        onClick = onLogout,
                        enabled = uiState.canLogout,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Log out")
                    }
                }
            }
        }
    }
}

@Composable
fun AgentConnectionsRoute(
    uiState: AgentConnectionsUiState,
    onReload: () -> Unit,
    onRevokeConnection: (String) -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.isLinked) {
        if (uiState.isLinked) {
            onReload()
        }
    }

    SettingsScreenScaffold(
        title = "Agent Connections",
        onBack = onBack,
        isBackEnabled = uiState.revokingConnectionId == null
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
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
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        if (uiState.isLinked) {
                            Text(
                                text = "Review and revoke long-lived bot connections tied to this cloud account.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            OutlinedButton(
                                onClick = onReload,
                                enabled = uiState.isLoading.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (uiState.isLoading) "Loading..." else "Reload")
                            }
                        } else {
                            Text(
                                text = "Sign in to the cloud account to manage long-lived bot connections.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (uiState.instructions.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.instructions,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            if (uiState.isLinked && uiState.isLoading.not() && uiState.connections.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "No long-lived bot connections were created for this account.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            items(uiState.connections, key = { item -> item.connectionId }) { connection ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(connection.label, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = connection.connectionId,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text("Created: ${connection.createdAtLabel}")
                        Text("Last used: ${connection.lastUsedAtLabel}")
                        Text("Revoked: ${connection.revokedAtLabel}")
                        OutlinedButton(
                            onClick = {
                                onRevokeConnection(connection.connectionId)
                            },
                            enabled = connection.isRevoked.not() && uiState.revokingConnectionId != connection.connectionId,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                if (uiState.revokingConnectionId == connection.connectionId) {
                                    "Revoking..."
                                } else {
                                    "Revoke"
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AccountDangerZoneRoute(
    uiState: AccountDangerZoneUiState,
    onRequestDeleteConfirmation: () -> Unit,
    onDismissDeleteConfirmation: () -> Unit,
    onConfirmationTextChange: (String) -> Unit,
    onDeleteAccount: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Danger Zone",
        onBack = onBack,
        isBackEnabled = uiState.isDeleting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
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
                        Text(
                            text = "Danger zone",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = "Permanently delete this account and all cloud data.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                            CircularProgressIndicator()
                        }
                        Button(
                            onClick = onRequestDeleteConfirmation,
                            enabled = uiState.isLinked && uiState.isDeleting.not(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(if (uiState.isDeleting) "Deleting..." else "Delete my account")
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = "Sign in to a linked cloud account before deleting it.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    if (uiState.showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isDeleting.not()) {
                    onDismissDeleteConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onDeleteAccount,
                    enabled = uiState.isDeleting.not() && uiState.confirmationText == accountDeletionConfirmationText
                ) {
                    Text(if (uiState.isDeleting) "Deleting..." else "Delete my account")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeleting.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Delete account")
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Warning! This action is permanent. Type the phrase below exactly to continue.",
                        color = MaterialTheme.colorScheme.error
                    )
                    if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                        CircularProgressIndicator()
                    }
                    if (uiState.deleteState == DestructiveActionState.FAILED && uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Text(
                        text = accountDeletionConfirmationText,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = uiState.confirmationText,
                        onValueChange = onConfirmationTextChange,
                        label = {
                            Text("Confirmation text")
                        },
                        enabled = uiState.isDeleting.not(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        )
    }
}

@Composable
fun AccountLegalSupportRoute(onBack: () -> Unit) {
    val context = LocalContext.current
    val privacyUrl = stringResource(id = R.string.flashcards_privacy_policy_url)
    val termsUrl = stringResource(id = R.string.flashcards_terms_of_service_url)
    val supportUrl = stringResource(id = R.string.flashcards_support_url)
    val supportEmail = stringResource(id = R.string.flashcards_support_email_address)

    SettingsScreenScaffold(
        title = "Legal & Support",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = "Privacy policy",
                        summary = "Open hosted privacy details",
                        icon = Icons.Outlined.Description,
                        onClick = {
                            openExternalUrl(context = context, url = privacyUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = "Terms of service",
                        summary = "Open hosted terms",
                        icon = Icons.Outlined.Description,
                        onClick = {
                            openExternalUrl(context = context, url = termsUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = "Support",
                        summary = "Open hosted support page",
                        icon = Icons.AutoMirrored.Outlined.OpenInNew,
                        onClick = {
                            openExternalUrl(context = context, url = supportUrl)
                        }
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = "Support email",
                        summary = supportEmail,
                        icon = Icons.Outlined.MailOutline,
                        onClick = {
                            sendSupportEmail(context = context, emailAddress = supportEmail)
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun AccountOpenSourceRoute(onBack: () -> Unit) {
    val context = LocalContext.current
    val repositoryUrl = stringResource(id = R.string.flashcards_repository_url)

    SettingsScreenScaffold(
        title = "Open Source",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    SettingsLinkItem(
                        title = "GitHub repository",
                        summary = "Open MIT-licensed source repository",
                        icon = Icons.Outlined.Code,
                        onClick = {
                            openExternalUrl(context = context, url = repositoryUrl)
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun DeviceDiagnosticsRoute(
    uiState: DeviceDiagnosticsUiState,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "This Device",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DeviceInfoCard(
                    title = "Workspace",
                    rows = listOf(
                        "Name" to uiState.workspaceName,
                        "Workspace ID" to uiState.workspaceId
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "App",
                    rows = listOf(
                        "Version" to uiState.appVersion,
                        "Build" to uiState.buildNumber,
                        "Client" to uiState.clientLabel,
                        "Storage" to uiState.storageLabel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "Device",
                    rows = listOf(
                        "Operating system" to uiState.operatingSystem,
                        "Model" to uiState.deviceModel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "Local sync diagnostics",
                    rows = listOf(
                        "Outbox entries" to uiState.outboxEntriesCount.toString(),
                        "Last sync cursor" to uiState.lastSyncCursor,
                        "Last sync attempt" to uiState.lastSyncAttempt,
                        "Last successful sync" to uiState.lastSuccessfulSync,
                        "Last sync error" to uiState.lastSyncError
                    )
                )
            }
        }
    }
}

@Composable
fun AccessRoute(
    onOpenCapability: (AccessCapability) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val capabilityStates = AccessCapability.entries.map { capability ->
        val status = if (activity == null) {
            AccessStatus.UNAVAILABLE
        } else {
            resolveAccessStatus(
                activity = activity,
                capability = capability,
                hasRequestedPermission = hasRequestedAccessPermission(context = context, capability = capability)
            )
        }
        AccessCapabilityUiState(
            capability = capability,
            title = accessCapabilityTitle(capability = capability),
            summary = accessCapabilitySummary(capability = capability),
            status = status,
            guidance = accessCapabilityGuidance(capability = capability, status = status),
            primaryActionLabel = accessCapabilityPrimaryActionLabel(status = status)
        )
    }

    SettingsScreenScaffold(
        title = "Access",
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            items(capabilityStates, key = { item -> item.capability.name }) { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(item.title)
                        },
                        supportingContent = {
                            Text(item.status.name.lowercase().replaceFirstChar(Char::uppercase))
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.Info,
                                contentDescription = null
                            )
                        },
                        modifier = Modifier.clickable {
                            onOpenCapability(item.capability)
                        }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccessDetailRoute(
    capability: AccessCapability,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? ComponentActivity
    val permission = accessCapabilityPermission(capability = capability)
    var permissionResultVersion by remember(capability) {
        mutableStateOf(value = 0)
    }
    val status = if (activity == null) {
        AccessStatus.UNAVAILABLE
    } else {
        permissionResultVersion
        resolveAccessStatus(
            activity = activity,
            capability = capability,
            hasRequestedPermission = hasRequestedAccessPermission(context = context, capability = capability)
        )
    }
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) {
        permissionResultVersion += 1
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(accessCapabilityTitle(capability = capability))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DeviceInfoCard(
                    title = accessCapabilityTitle(capability = capability),
                    rows = listOf(
                        "Status" to status.name.lowercase().replaceFirstChar(Char::uppercase),
                        "Usage" to accessCapabilitySummary(capability = capability)
                    )
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = accessCapabilityGuidance(capability = capability, status = status),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }

            val primaryActionLabel = accessCapabilityPrimaryActionLabel(status = status)
            if (primaryActionLabel != null) {
                item {
                    Button(
                        onClick = {
                            when (status) {
                                AccessStatus.ASK_EVERY_TIME -> {
                                    requireNotNull(permission) {
                                        "Android permission is required for this capability."
                                    }
                                    markAccessPermissionRequested(context = context, capability = capability)
                                    launcher.launch(permission)
                                }
                                AccessStatus.ALLOWED,
                                AccessStatus.BLOCKED -> {
                                    openApplicationSettings(context = context)
                                }
                                AccessStatus.SYSTEM_PICKER,
                                AccessStatus.UNAVAILABLE -> Unit
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(primaryActionLabel)
                    }
                }
            }
        }
    }
}

@Composable
fun WorkspaceExportRoute(
    viewModel: WorkspaceExportViewModel,
    onBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var pendingExportData by remember {
        mutableStateOf<WorkspaceExportData?>(value = null)
    }
    val createDocumentLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/csv")
    ) { uri ->
        val exportData = pendingExportData
        if (uri == null || exportData == null) {
            viewModel.finishExport()
            pendingExportData = null
            return@rememberLauncherForActivityResult
        }

        coroutineScope.launch {
            try {
                writeWorkspaceExportCsv(
                    contentResolver = context.contentResolver,
                    uri = uri,
                    csv = makeWorkspaceCardsCsv(exportData = exportData)
                )
                viewModel.finishExport()
            } catch (error: IllegalArgumentException) {
                viewModel.showExportError(message = error.message ?: "Android export failed.")
            } catch (error: IllegalStateException) {
                viewModel.showExportError(message = error.message ?: "Android export failed.")
            }
            pendingExportData = null
        }
    }

    SettingsScreenScaffold(
        title = "Export",
        onBack = onBack,
        isBackEnabled = uiState.isExporting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("CSV export")
                        },
                        supportingContent = {
                            Text("${uiState.activeCardsCount} active cards from ${uiState.workspaceName}")
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.SaveAlt,
                                contentDescription = null
                            )
                        }
                    )
                }
            }

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
                Button(
                    onClick = {
                        coroutineScope.launch {
                            viewModel.clearErrorMessage()
                            val exportData = viewModel.prepareExportData()
                            if (exportData == null) {
                                return@launch
                            }

                            pendingExportData = exportData
                            createDocumentLauncher.launch(
                                makeWorkspaceExportFilename(
                                    workspaceName = exportData.workspaceName,
                                    date = LocalDate.now()
                                )
                            )
                        }
                    },
                    enabled = uiState.isExporting.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isExporting) "Preparing export..." else "Export CSV")
                }
            }

            item {
                OutlinedButton(
                    onClick = {
                        viewModel.clearErrorMessage()
                    },
                    enabled = uiState.errorMessage.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Dismiss error")
                }
            }
        }
    }
}

@Composable
private fun SettingsLinkItem(
    title: String,
    summary: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = {
            Text(title)
        },
        supportingContent = {
            Text(summary)
        },
        leadingContent = {
            Icon(
                imageVector = icon,
                contentDescription = null
            )
        },
        trailingContent = {
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                contentDescription = null
            )
        },
        modifier = Modifier.clickable(onClick = onClick)
    )
}

@Composable
private fun DeviceInfoCard(title: String, rows: List<Pair<String, String>>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )

            rows.forEach { row ->
                Text(
                    text = row.first,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = row.second,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }
}
