package com.flashcardsopensourceapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.di.AppStartupState
import com.flashcardsopensourceapp.app.navigation.AppNavHost
import com.flashcardsopensourceapp.app.navigation.currentTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.navigateToTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.topLevelDestinations
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

private const val startupLoadingTag: String = "app.startupLoading"
private const val startupErrorTag: String = "app.startupError"

@Composable
fun FlashcardsApp(appGraph: AppGraph) {
    FlashcardsTheme {
        val startupState by appGraph.startupState.collectAsStateWithLifecycle(
            initialValue = AppStartupState.Loading
        )
        when (val currentStartupState = startupState) {
            AppStartupState.Loading -> {
                StartupLoadingScreen()
                return@FlashcardsTheme
            }

            is AppStartupState.Failed -> {
                StartupErrorScreen(
                    message = currentStartupState.message,
                    onRetry = appGraph::retryStartup
                )
                return@FlashcardsTheme
            }

            AppStartupState.Ready -> Unit
        }

        val navController = rememberNavController()
        val lifecycleOwner = LocalLifecycleOwner.current
        val currentDestination = currentTopLevelDestination(navController = navController)
        val snackbarHostState = remember { SnackbarHostState() }
        val cloudSettings by appGraph.cloudAccountRepository.observeCloudSettings().collectAsStateWithLifecycle(
            initialValue = CloudSettings(
                installationId = "",
                cloudState = CloudAccountState.DISCONNECTED,
                linkedUserId = null,
                linkedWorkspaceId = null,
                linkedEmail = null,
                activeWorkspaceId = null,
                updatedAtMillis = 0L
            )
        )
        val accountDeletionState by appGraph.cloudAccountRepository.observeAccountDeletionState().collectAsStateWithLifecycle(
            initialValue = AccountDeletionState.Hidden
        )
        val syncStatusSnapshot by appGraph.syncRepository.observeSyncStatus().collectAsStateWithLifecycle(
            initialValue = SyncStatusSnapshot(
                status = SyncStatus.Idle,
                lastSuccessfulSyncAtMillis = null,
                lastErrorMessage = ""
            )
        )
        var isAppResumed by remember(lifecycleOwner) {
            mutableStateOf(
                value = lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            )
        }

        LaunchedEffect(appGraph.appMessageBus, snackbarHostState) {
            appGraph.appMessageBus.messages.collect { message ->
                snackbarHostState.showSnackbar(message = message)
            }
        }

        LaunchedEffect(appGraph.syncRepository) {
            var previousStatus: SyncStatus? = null
            appGraph.syncRepository.observeSyncStatus().collect { snapshot ->
                if (snapshot.status is SyncStatus.Failed && previousStatus !is SyncStatus.Failed) {
                    val failedStatus = snapshot.status as SyncStatus.Failed
                    appGraph.appMessageBus.showMessage(
                        message = "Sync failed: ${failedStatus.message}"
                    )
                }
                if (snapshot.status is SyncStatus.Blocked && previousStatus !is SyncStatus.Blocked) {
                    val blockedStatus = snapshot.status as SyncStatus.Blocked
                    appGraph.appMessageBus.showMessage(
                        message = blockedStatus.message
                    )
                }
                previousStatus = snapshot.status
            }
        }

        DisposableEffect(lifecycleOwner) {
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_RESUME -> {
                        isAppResumed = true
                        appGraph.reviewNotificationsManager.markAppResumed(
                            nowMillis = System.currentTimeMillis()
                        )
                    }

                    Lifecycle.Event.ON_PAUSE -> {
                        isAppResumed = false
                        appGraph.reviewNotificationsManager.markAppPaused(
                            nowMillis = System.currentTimeMillis()
                        )
                    }

                    else -> Unit
                }
            }

            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
        }

        LaunchedEffect(appGraph.cloudAccountRepository) {
            appGraph.cloudAccountRepository.resumePendingAccountDeletionIfNeeded()
        }

        LaunchedEffect(
            isAppResumed,
            cloudSettings.cloudState,
            syncStatusSnapshot.status,
            accountDeletionState,
            currentDestination.route
        ) {
            if (
                isAppResumed.not() || shouldRunForegroundSyncPolling(
                    cloudState = cloudSettings.cloudState,
                    accountDeletionState = accountDeletionState,
                    destination = currentDestination,
                    syncStatus = syncStatusSnapshot.status
                ).not()
            ) {
                return@LaunchedEffect
            }

            runCatching {
                appGraph.syncRepository.syncNow()
            }
        }

        LaunchedEffect(
            isAppResumed,
            cloudSettings.cloudState,
            syncStatusSnapshot.status,
            accountDeletionState,
            currentDestination.route
        ) {
            if (
                isAppResumed.not() || shouldRunForegroundSyncPolling(
                    cloudState = cloudSettings.cloudState,
                    accountDeletionState = accountDeletionState,
                    destination = currentDestination,
                    syncStatus = syncStatusSnapshot.status
                ).not()
            ) {
                return@LaunchedEffect
            }

            while (true) {
                delay(foregroundSyncPollingIntervalMillis(destination = currentDestination))
                runCatching {
                    appGraph.syncRepository.syncNow()
                }
            }
        }

        NavigationSuiteScaffold(
            navigationSuiteItems = {
                topLevelDestinations.forEach { destination ->
                    item(
                        selected = currentDestination.route == destination.route,
                        onClick = {
                            navigateToTopLevelDestination(
                                navController = navController,
                                destination = destination
                            )
                        },
                        icon = {
                            Icon(
                                imageVector = destination.icon,
                                contentDescription = destination.label
                            )
                        },
                        label = {
                            Text(destination.label)
                        }
                    )
                }
            }
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                AppNavHost(
                    appGraph = appGraph,
                    navController = navController
                )
                SnackbarHost(
                    hostState = snackbarHostState,
                    modifier = Modifier
                        .align(alignment = Alignment.BottomCenter)
                        .padding(horizontal = 16.dp, vertical = 24.dp)
                )
                AccountDeletionBlockingSurface(
                    accountDeletionState = accountDeletionState,
                    onRetryDeletion = {
                        appGraph.cloudAccountRepository.retryPendingAccountDeletion()
                    }
                )
            }
        }
    }
}

@Composable
private fun StartupLoadingScreen() {
    Surface(
        modifier = Modifier
            .fillMaxSize()
            .testTag(startupLoadingTag)
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun StartupErrorScreen(
    message: String,
    onRetry: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxSize()
            .testTag(startupErrorTag)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Startup failed",
                        style = MaterialTheme.typography.titleLarge
                    )
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Button(onClick = onRetry) {
                        Text(text = "Retry startup")
                    }
                }
            }
        }
    }
}

@Composable
internal fun AccountDeletionBlockingSurface(
    accountDeletionState: AccountDeletionState,
    onRetryDeletion: suspend () -> Unit
) {
    if (accountDeletionState == AccountDeletionState.Hidden) {
        return
    }

    val coroutineScope = rememberCoroutineScope()

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.82f))
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 6.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .statusBarsPadding()
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp)
            ) {
                Text(
                    text = "Deleting account",
                    style = MaterialTheme.typography.headlineSmall
                )
                when (accountDeletionState) {
                    AccountDeletionState.Hidden -> Unit
                    AccountDeletionState.InProgress -> {
                        CircularProgressIndicator()
                        Text(
                            text = "Your account deletion is in progress. Keep this screen open until it finishes.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    is AccountDeletionState.Failed -> {
                        Text(
                            text = "The delete request did not finish yet. Retry to keep the account deletion moving forward.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = accountDeletionState.message,
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.padding(16.dp)
                            )
                        }
                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    onRetryDeletion()
                                }
                            },
                            enabled = true,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Retry deletion")
                        }
                    }
                }
            }
        }
    }
}
