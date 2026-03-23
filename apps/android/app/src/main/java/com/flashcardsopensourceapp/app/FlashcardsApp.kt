package com.flashcardsopensourceapp.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import androidx.navigation.compose.rememberNavController
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.AppNavHost
import com.flashcardsopensourceapp.app.navigation.currentTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.navigateToTopLevelDestination
import com.flashcardsopensourceapp.app.navigation.topLevelDestinations
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import kotlinx.coroutines.flow.collect

@Composable
fun FlashcardsApp(appGraph: AppGraph) {
    FlashcardsTheme {
        val navController = rememberNavController()
        val currentDestination = currentTopLevelDestination(navController = navController)
        val snackbarHostState = remember { SnackbarHostState() }

        LaunchedEffect(appGraph.appMessageBus, snackbarHostState) {
            appGraph.appMessageBus.messages.collect { message ->
                snackbarHostState.showSnackbar(message = message)
            }
        }

        LaunchedEffect(appGraph.syncRepository) {
            var previousStatus: SyncStatus? = null
            appGraph.syncRepository.observeSyncStatus().collect { snapshot ->
                when {
                    snapshot.status is SyncStatus.Syncing && previousStatus !is SyncStatus.Syncing -> {
                        appGraph.appMessageBus.showMessage(message = "Sync started.")
                    }

                    snapshot.status is SyncStatus.Idle && previousStatus is SyncStatus.Syncing -> {
                        appGraph.appMessageBus.showMessage(message = "Sync completed.")
                    }

                    snapshot.status is SyncStatus.Failed && previousStatus !is SyncStatus.Failed -> {
                        val failedStatus = snapshot.status as SyncStatus.Failed
                        appGraph.appMessageBus.showMessage(
                            message = "Sync failed: ${failedStatus.message}"
                        )
                    }
                }
                previousStatus = snapshot.status
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
            }
        }
    }
}
