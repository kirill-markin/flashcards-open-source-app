package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.AccountAdvancedRoute
import com.flashcardsopensourceapp.feature.settings.AccountDangerZoneRoute
import com.flashcardsopensourceapp.feature.settings.AccountLegalSupportRoute
import com.flashcardsopensourceapp.feature.settings.AccountOpenSourceRoute
import com.flashcardsopensourceapp.feature.settings.AccountRoute
import com.flashcardsopensourceapp.feature.settings.AccountStatusRoute
import com.flashcardsopensourceapp.feature.settings.AgentConnectionsRoute
import com.flashcardsopensourceapp.feature.settings.ServerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.createAccountDangerZoneViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAccountStatusViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAgentConnectionsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createServerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal fun NavGraphBuilder.registerSettingsAccountNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = SettingsAccountDestination.route,
        route = SettingsAccountGraph.route
    ) {
        composable(route = SettingsAccountDestination.route) { backStackEntry ->
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

            AccountRoute(
                workspaceName = uiState.workspaceName,
                onOpenStatus = {
                    navController.navigate(route = SettingsAccountStatusDestination.route)
                },
                onOpenLegalSupport = {
                    navController.navigate(route = SettingsAccountLegalSupportDestination.route)
                },
                onOpenOpenSource = {
                    navController.navigate(route = SettingsAccountOpenSourceDestination.route)
                },
                onOpenAdvanced = {
                    navController.navigate(route = SettingsAccountAdvancedDestination.route)
                },
                onOpenAgentConnections = {
                    navController.navigate(route = SettingsAccountAgentConnectionsDestination.route)
                },
                onOpenDangerZone = {
                    navController.navigate(route = SettingsAccountDangerZoneDestination.route)
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountStatusDestination.route) {
            val context = LocalContext.current
            val accountStatusViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountStatusViewModel>(
                factory = createAccountStatusViewModelFactory(
                    workspaceRepository = appGraph.workspaceRepository,
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository,
                    messageController = appGraph.appMessageBus,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by accountStatusViewModel.uiState.collectAsStateWithLifecycle()

            AccountStatusRoute(
                uiState = uiState,
                onOpenSignIn = {
                    navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                },
                onSyncNow = {
                    coroutineScope.launch {
                        accountStatusViewModel.syncNow()
                    }
                },
                onRequestLogout = accountStatusViewModel::requestLogoutConfirmation,
                onDismissLogoutConfirmation = accountStatusViewModel::dismissLogoutConfirmation,
                onConfirmLogout = {
                    coroutineScope.launch {
                        accountStatusViewModel.confirmLogout()
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountAdvancedDestination.route) {
            AccountAdvancedRoute(
                onOpenServer = {
                    navController.navigate(route = SettingsAccountServerDestination.route)
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountServerDestination.route) {
            val context = LocalContext.current
            val serverSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.ServerSettingsViewModel>(
                factory = createServerSettingsViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by serverSettingsViewModel.uiState.collectAsStateWithLifecycle()

            ServerSettingsRoute(
                uiState = uiState,
                onCustomOriginChange = serverSettingsViewModel::updateCustomOrigin,
                onValidateCustomServer = {
                    coroutineScope.launch {
                        serverSettingsViewModel.validateCustomServer()
                    }
                },
                onApplyPreviewConfiguration = {
                    coroutineScope.launch {
                        serverSettingsViewModel.applyPreviewConfiguration()
                    }
                },
                onResetToOfficialServer = {
                    coroutineScope.launch {
                        serverSettingsViewModel.resetToOfficialServer()
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountLegalSupportDestination.route) {
            AccountLegalSupportRoute(
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountOpenSourceDestination.route) {
            AccountOpenSourceRoute(
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountAgentConnectionsDestination.route) {
            val context = LocalContext.current
            val agentConnectionsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AgentConnectionsViewModel>(
                factory = createAgentConnectionsViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by agentConnectionsViewModel.uiState.collectAsStateWithLifecycle()

            AgentConnectionsRoute(
                uiState = uiState,
                onReload = {
                    coroutineScope.launch {
                        agentConnectionsViewModel.loadConnections()
                    }
                },
                onRevokeConnection = { connectionId ->
                    coroutineScope.launch {
                        agentConnectionsViewModel.revokeConnection(connectionId = connectionId)
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountDangerZoneDestination.route) {
            val context = LocalContext.current
            val accountDangerZoneViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountDangerZoneViewModel>(
                factory = createAccountDangerZoneViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by accountDangerZoneViewModel.uiState.collectAsStateWithLifecycle()

            AccountDangerZoneRoute(
                uiState = uiState,
                onRequestDeleteConfirmation = accountDangerZoneViewModel::requestDeleteConfirmation,
                onDismissDeleteConfirmation = accountDangerZoneViewModel::dismissDeleteConfirmation,
                onConfirmationTextChange = accountDangerZoneViewModel::updateConfirmationText,
                onDeleteAccount = {
                    coroutineScope.launch {
                        accountDangerZoneViewModel.deleteAccount()
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}
