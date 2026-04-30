package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.device.DeviceDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.device.createDeviceDiagnosticsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.CurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.workspace.createCurrentWorkspaceViewModelFactory
import kotlinx.coroutines.CoroutineScope

internal fun NavGraphBuilder.registerSettingsRootDestinations(
    appGraph: AppGraph,
    navController: NavHostController,
    packageInfo: AppPackageInfo,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsDestination.route) { backStackEntry ->
        val context = LocalContext.current
        val settingsRootBackStackEntry = settingsRootBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry
        )
            val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
                viewModelStoreOwner = settingsRootBackStackEntry,
                factory = createSettingsViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    autoSyncEventRepository = appGraph.autoSyncEventRepository,
                    messageController = appGraph.appMessageBus,
                    visibleAppScreenRepository = appGraph.visibleAppScreenController,
                    applicationContext = context.applicationContext
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
        val context = LocalContext.current
        val manageSignInMessage = stringResource(
            id = com.flashcardsopensourceapp.feature.settings.R.string.settings_current_workspace_manage_sign_in_message
        )
        val currentWorkspaceViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.CurrentWorkspaceViewModel>(
            factory = createCurrentWorkspaceViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                applicationContext = context.applicationContext
            )
        )
        val uiState by currentWorkspaceViewModel.uiState.collectAsStateWithLifecycle()

        CurrentWorkspaceRoute(
            uiState = uiState,
            onReload = {
                currentWorkspaceViewModel.loadWorkspacesAsync()
            },
            onSwitchToExistingWorkspace = { workspaceId ->
                currentWorkspaceViewModel.switchWorkspaceAsync(
                    selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.Existing(
                        workspaceId = workspaceId
                    )
                )
            },
            onCreateWorkspace = {
                currentWorkspaceViewModel.switchWorkspaceAsync(
                    selection = com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection.CreateNew
                )
            },
            onOpenSignIn = {
                appGraph.appMessageBus.showMessage(
                    message = manageSignInMessage
                )
                navController.navigate(route = SettingsAccountSignInEmailDestination.route)
            },
            onRetryLastWorkspaceAction = {
                currentWorkspaceViewModel.retryLastWorkspaceActionAsync()
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsDeviceDestination.route) {
        val context = LocalContext.current
        val deviceDiagnosticsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.device.DeviceDiagnosticsViewModel>(
            factory = createDeviceDiagnosticsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                appVersion = packageInfo.versionName,
                buildNumber = packageInfo.longVersionCode.toString(),
                applicationContext = context.applicationContext
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
