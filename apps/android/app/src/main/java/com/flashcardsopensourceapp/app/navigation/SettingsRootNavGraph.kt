package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.DeviceDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.createCurrentWorkspaceViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeviceDiagnosticsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal fun NavGraphBuilder.registerSettingsRootDestinations(
    appGraph: AppGraph,
    navController: NavHostController,
    packageInfo: AppPackageInfo,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsDestination.route) { backStackEntry ->
        val settingsRootBackStackEntry = settingsRootBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry
        )
        val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
            viewModelStoreOwner = settingsRootBackStackEntry,
            factory = createSettingsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository
            )
        )
        val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()

        SettingsRoute(
            uiState = uiState,
            onOpenCurrentWorkspace = {
                navController.navigate(route = SettingsCurrentWorkspaceDestination.route)
            },
            onOpenWorkspace = {
                navController.navigate(route = SettingsWorkspaceDestination.route)
            },
            onOpenAccount = {
                navController.navigate(route = SettingsAccountDestination.route)
            },
            onOpenDevice = {
                navController.navigate(route = SettingsDeviceDestination.route)
            },
            onOpenAccess = {
                navController.navigate(route = SettingsAccessDestination.route)
            }
        )
    }

    composable(route = SettingsCurrentWorkspaceDestination.route) {
        val currentWorkspaceViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceViewModel>(
            factory = createCurrentWorkspaceViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val uiState by currentWorkspaceViewModel.uiState.collectAsStateWithLifecycle()

        CurrentWorkspaceRoute(
            uiState = uiState,
            onReload = {
                coroutineScope.launch {
                    currentWorkspaceViewModel.loadWorkspaces()
                }
            },
            onSwitchToExistingWorkspace = { workspaceId ->
                coroutineScope.launch {
                    currentWorkspaceViewModel.switchWorkspace(
                        selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.Existing(
                            workspaceId = workspaceId
                        )
                    )
                }
            },
            onCreateWorkspace = {
                coroutineScope.launch {
                    currentWorkspaceViewModel.switchWorkspace(
                        selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.CreateNew
                    )
                }
            },
            onOpenSignIn = {
                appGraph.appMessageBus.showMessage(message = "Sign in to manage linked workspaces.")
                navController.navigate(route = SettingsAccountSignInEmailDestination.route)
            },
            onRetryLastWorkspaceAction = {
                coroutineScope.launch {
                    currentWorkspaceViewModel.retryLastWorkspaceAction()
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsDeviceDestination.route) {
        val deviceDiagnosticsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeviceDiagnosticsViewModel>(
            factory = createDeviceDiagnosticsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                appVersion = packageInfo.versionName,
                buildNumber = packageInfo.longVersionCode.toString()
            )
        )
        val uiState by deviceDiagnosticsViewModel.uiState.collectAsStateWithLifecycle()

        DeviceDiagnosticsRoute(
            uiState = uiState,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}

@Composable
internal fun settingsRootBackStackEntry(
    navController: NavHostController,
    currentBackStackEntry: NavBackStackEntry
): NavBackStackEntry {
    return rememberRouteBackStackEntry(
        navController = navController,
        currentBackStackEntry = currentBackStackEntry,
        route = SettingsRootGraph.route
    )
}
