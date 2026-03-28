package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.AccessCapability
import com.flashcardsopensourceapp.feature.settings.AccessDetailRoute
import com.flashcardsopensourceapp.feature.settings.AccessRoute
import com.flashcardsopensourceapp.feature.settings.AccountAdvancedRoute
import com.flashcardsopensourceapp.feature.settings.AccountDangerZoneRoute
import com.flashcardsopensourceapp.feature.settings.AccountLegalSupportRoute
import com.flashcardsopensourceapp.feature.settings.AccountOpenSourceRoute
import com.flashcardsopensourceapp.feature.settings.AccountRoute
import com.flashcardsopensourceapp.feature.settings.AccountStatusRoute
import com.flashcardsopensourceapp.feature.settings.AgentConnectionsRoute
import com.flashcardsopensourceapp.feature.settings.CloudPostAuthRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInCodeRoute
import com.flashcardsopensourceapp.feature.settings.CloudSignInEmailRoute
import com.flashcardsopensourceapp.feature.settings.CurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.DeckDetailRoute
import com.flashcardsopensourceapp.feature.settings.DeckEditorRoute
import com.flashcardsopensourceapp.feature.settings.DecksRoute
import com.flashcardsopensourceapp.feature.settings.DeviceDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.ServerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SchedulerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceExportRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceSettingsRoute
import com.flashcardsopensourceapp.feature.settings.WorkspaceTagsRoute
import com.flashcardsopensourceapp.feature.settings.createAccountDangerZoneViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAccountStatusViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAgentConnectionsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createAllCardsDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createCloudSignInViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createCurrentWorkspaceViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeckDetailViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeckEditorViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDecksViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createDeviceDiagnosticsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSchedulerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createServerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceExportViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.createWorkspaceTagsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.DeckListTargetUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerSettingsNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    packageInfo: AppPackageInfo,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsDestination.route) {
        val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
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

    composable(route = SettingsWorkspaceDestination.route) {
        val workspaceSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceSettingsViewModel>(
            factory = createWorkspaceSettingsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )
        val uiState by workspaceSettingsViewModel.uiState.collectAsStateWithLifecycle()

        WorkspaceSettingsRoute(
            uiState = uiState,
            onOpenOverview = {
                navController.navigate(route = SettingsWorkspaceOverviewDestination.route)
            },
            onOpenDecks = {
                navController.navigate(route = SettingsWorkspaceDecksDestination.route)
            },
            onOpenTags = {
                navController.navigate(route = SettingsWorkspaceTagsDestination.route)
            },
            onOpenScheduler = {
                navController.navigate(route = SettingsWorkspaceSchedulerDestination.route)
            },
            onOpenExport = {
                navController.navigate(route = SettingsWorkspaceExportDestination.route)
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceOverviewDestination.route) {
        val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceOverviewViewModel>(
            factory = createWorkspaceOverviewViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val uiState by workspaceOverviewViewModel.uiState.collectAsStateWithLifecycle()

        WorkspaceOverviewRoute(
            uiState = uiState,
            onWorkspaceNameChange = workspaceOverviewViewModel::updateWorkspaceNameDraft,
            onSaveWorkspaceName = {
                coroutineScope.launch {
                    workspaceOverviewViewModel.saveWorkspaceName()
                }
            },
            onRequestDeleteWorkspace = {
                coroutineScope.launch {
                    workspaceOverviewViewModel.requestDeleteWorkspace()
                }
            },
            onDismissDeletePreviewAlert = workspaceOverviewViewModel::dismissDeletePreviewAlert,
            onOpenDeleteConfirmation = workspaceOverviewViewModel::openDeleteConfirmation,
            onDeleteConfirmationTextChange = workspaceOverviewViewModel::updateDeleteConfirmationText,
            onDismissDeleteConfirmation = workspaceOverviewViewModel::dismissDeleteConfirmation,
            onDeleteWorkspace = {
                coroutineScope.launch {
                    workspaceOverviewViewModel.deleteWorkspace()
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceDecksDestination.route) {
        val decksViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DecksViewModel>(
            factory = createDecksViewModelFactory(
                decksRepository = appGraph.decksRepository,
                workspaceRepository = appGraph.workspaceRepository
            )
        )
        val uiState by decksViewModel.uiState.collectAsStateWithLifecycle()

        DecksRoute(
            uiState = uiState,
            onSearchQueryChange = decksViewModel::updateSearchQuery,
            onOpenDeck = { deckTarget ->
                when (deckTarget) {
                    DeckListTargetUiState.AllCards -> {
                        navController.navigate(route = SettingsWorkspaceAllCardsDeckDetailDestination.route)
                    }

                    is DeckListTargetUiState.PersistedDeck -> {
                        navController.navigate(
                            route = SettingsWorkspaceDeckDetailDestination.createRoute(deckId = deckTarget.deckId)
                        )
                    }
                }
            },
            onCreateDeck = {
                navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = "new"))
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceAllCardsDeckDetailDestination.route) {
        val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckDetailViewModel>(
            factory = createAllCardsDeckDetailViewModelFactory(
                decksRepository = appGraph.decksRepository,
                cardsRepository = appGraph.cardsRepository,
                workspaceRepository = appGraph.workspaceRepository
            )
        )
        val uiState by deckDetailViewModel.uiState.collectAsStateWithLifecycle()

        DeckDetailRoute(
            uiState = uiState,
            onEditDeck = {},
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onDeleteDeck = {},
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = SettingsWorkspaceDeckDetailDestination.routePattern,
        arguments = listOf(navArgument(name = SettingsWorkspaceDeckDetailDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val deckId = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckDetailDestination.routeArgument)) {
            "Deck detail route requires deckId."
        }
        val deckDetailViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckDetailViewModel>(
            factory = createDeckDetailViewModelFactory(
                decksRepository = appGraph.decksRepository,
                cardsRepository = appGraph.cardsRepository,
                workspaceRepository = appGraph.workspaceRepository,
                deckId = deckId
            )
        )
        val uiState by deckDetailViewModel.uiState.collectAsStateWithLifecycle()

        DeckDetailRoute(
            uiState = uiState,
            onEditDeck = { editingDeckId ->
                navController.navigate(route = SettingsWorkspaceDeckEditorDestination.createRoute(deckId = editingDeckId))
            },
            onOpenCard = { cardId ->
                appGraph.appHandoffCoordinator.requestCardEditor(cardId = cardId)
            },
            onDeleteDeck = { deletingDeckId ->
                coroutineScope.launch {
                    appGraph.decksRepository.deleteDeck(deckId = deletingDeckId)
                    withContext(Dispatchers.Main.immediate) {
                        navController.popBackStack()
                    }
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = SettingsWorkspaceDeckEditorDestination.routePattern,
        arguments = listOf(navArgument(name = SettingsWorkspaceDeckEditorDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val editingArgument = requireNotNull(backStackEntry.arguments?.getString(SettingsWorkspaceDeckEditorDestination.routeArgument)) {
            "Deck editor route requires deckId."
        }
        val editingDeckId = if (editingArgument == "new") null else editingArgument
        val deckEditorViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.DeckEditorViewModel>(
            factory = createDeckEditorViewModelFactory(
                decksRepository = appGraph.decksRepository,
                workspaceRepository = appGraph.workspaceRepository,
                editingDeckId = editingDeckId
            )
        )
        val uiState by deckEditorViewModel.uiState.collectAsStateWithLifecycle()

        DeckEditorRoute(
            uiState = uiState,
            onNameChange = deckEditorViewModel::updateName,
            onToggleEffortLevel = deckEditorViewModel::toggleEffortLevel,
            onToggleTag = deckEditorViewModel::toggleTag,
            onSave = {
                coroutineScope.launch {
                    val didSave = deckEditorViewModel.save(editingDeckId = editingDeckId)
                    if (didSave) {
                        withContext(Dispatchers.Main.immediate) {
                            navController.popBackStack()
                        }
                    }
                }
            },
            onDelete = if (editingDeckId == null) {
                null
            } else {
                {
                    coroutineScope.launch {
                        val didDelete = deckEditorViewModel.delete(editingDeckId = editingDeckId)
                        if (didDelete) {
                            withContext(Dispatchers.Main.immediate) {
                                navController.popBackStack(route = SettingsWorkspaceDecksDestination.route, inclusive = false)
                            }
                        }
                    }
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceTagsDestination.route) {
        val workspaceTagsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceTagsViewModel>(
            factory = createWorkspaceTagsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )
        val uiState by workspaceTagsViewModel.uiState.collectAsStateWithLifecycle()

        WorkspaceTagsRoute(
            uiState = uiState,
            onSearchQueryChange = workspaceTagsViewModel::updateSearchQuery,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceSchedulerDestination.route) {
        val schedulerSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SchedulerSettingsViewModel>(
            factory = createSchedulerSettingsViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )
        val uiState by schedulerSettingsViewModel.uiState.collectAsStateWithLifecycle()

        SchedulerSettingsRoute(
            uiState = uiState,
            onDesiredRetentionChange = schedulerSettingsViewModel::updateDesiredRetention,
            onLearningStepsChange = schedulerSettingsViewModel::updateLearningSteps,
            onRelearningStepsChange = schedulerSettingsViewModel::updateRelearningSteps,
            onMaximumIntervalDaysChange = schedulerSettingsViewModel::updateMaximumIntervalDays,
            onEnableFuzzChange = schedulerSettingsViewModel::updateEnableFuzz,
            onRequestSave = schedulerSettingsViewModel::requestSave,
            onDismissSaveConfirmation = schedulerSettingsViewModel::dismissSaveConfirmation,
            onConfirmSave = {
                coroutineScope.launch {
                    val didSave = schedulerSettingsViewModel.save()
                    if (didSave) {
                        withContext(Dispatchers.Main.immediate) {
                            navController.popBackStack()
                        }
                    }
                }
            },
            onResetToDefaults = schedulerSettingsViewModel::resetToDefaults,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceExportDestination.route) {
        val workspaceExportViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.WorkspaceExportViewModel>(
            factory = createWorkspaceExportViewModelFactory(workspaceRepository = appGraph.workspaceRepository)
        )

        WorkspaceExportRoute(
            viewModel = workspaceExportViewModel,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsAccountDestination.route) { backStackEntry ->
        val settingsBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = SettingsDestination.route
        )
        val settingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.SettingsViewModel>(
            viewModelStoreOwner = settingsBackStackEntry,
            factory = createSettingsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository
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
        val accountStatusViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountStatusViewModel>(
            factory = createAccountStatusViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
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
        val serverSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.ServerSettingsViewModel>(
            factory = createServerSettingsViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository
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

    composable(route = SettingsAccountSignInEmailDestination.route) {
        val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CloudSignInViewModel>(
            factory = createCloudSignInViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val uiState by signInViewModel.uiState.collectAsStateWithLifecycle()

        CloudSignInEmailRoute(
            uiState = uiState,
            onEmailChange = signInViewModel::updateEmail,
            onSendCode = {
                coroutineScope.launch {
                    val didCreateChallenge = signInViewModel.sendCode()
                    if (didCreateChallenge) {
                        navController.navigate(route = SettingsAccountSignInCodeDestination.route)
                    }
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsAccountSignInCodeDestination.route) { backStackEntry ->
        val emailRouteBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = SettingsAccountSignInEmailDestination.route
        )
        val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CloudSignInViewModel>(
            viewModelStoreOwner = emailRouteBackStackEntry,
            factory = createCloudSignInViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val uiState by signInViewModel.uiState.collectAsStateWithLifecycle()

        CloudSignInCodeRoute(
            uiState = uiState,
            onCodeChange = signInViewModel::updateCode,
            onVerifyCode = {
                coroutineScope.launch {
                    val didVerify = signInViewModel.verifyCode()
                    if (didVerify) {
                        navController.navigate(route = SettingsAccountPostAuthDestination.route)
                    }
                }
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsAccountPostAuthDestination.route) { backStackEntry ->
        val emailRouteBackStackEntry = rememberRouteBackStackEntry(
            navController = navController,
            currentBackStackEntry = backStackEntry,
            route = SettingsAccountSignInEmailDestination.route
        )
        val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.CloudSignInViewModel>(
            viewModelStoreOwner = emailRouteBackStackEntry,
            factory = createCloudSignInViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                syncRepository = appGraph.syncRepository,
                messageController = appGraph.appMessageBus
            )
        )
        val uiState by signInViewModel.postAuthUiState.collectAsStateWithLifecycle()

        if (uiState.completionToken != null) {
            androidx.compose.runtime.LaunchedEffect(uiState.completionToken) {
                signInViewModel.acknowledgePostAuthCompletion()
                navigateToTopLevelDestination(
                    navController = navController,
                    destination = SettingsDestination
                )
                navController.navigate(route = SettingsAccountStatusDestination.route)
            }
        }

        CloudPostAuthRoute(
            uiState = uiState,
            onAutoContinue = {
                coroutineScope.launch {
                    signInViewModel.completePendingPostAuthIfNeeded()
                }
            },
            onSelectWorkspace = { selection ->
                coroutineScope.launch {
                    signInViewModel.selectPostAuthWorkspace(selection = selection)
                }
            },
            onRetry = {
                coroutineScope.launch {
                    signInViewModel.retryPostAuth()
                }
            },
            onLogout = {
                coroutineScope.launch {
                    signInViewModel.logoutAfterPostAuthFailure()
                    navigateToTopLevelDestination(
                        navController = navController,
                        destination = SettingsDestination
                    )
                    navController.navigate(route = SettingsAccountStatusDestination.route)
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
        val agentConnectionsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AgentConnectionsViewModel>(
            factory = createAgentConnectionsViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository
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
        val accountDangerZoneViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.AccountDangerZoneViewModel>(
            factory = createAccountDangerZoneViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository
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

    composable(route = SettingsAccessDestination.route) {
        AccessRoute(
            onOpenCapability = { capability ->
                navController.navigate(
                    route = SettingsAccessDetailDestination.createRoute(capability = capability.name.lowercase())
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(
        route = SettingsAccessDetailDestination.routePattern,
        arguments = listOf(navArgument(name = SettingsAccessDetailDestination.routeArgument) {
            type = NavType.StringType
        })
    ) { backStackEntry ->
        val capabilityArgument = requireNotNull(
            backStackEntry.arguments?.getString(SettingsAccessDetailDestination.routeArgument)
        ) {
            "Access detail route requires capability."
        }
        val capability = AccessCapability.valueOf(capabilityArgument.uppercase())

        AccessDetailRoute(
            capability = capability,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}
