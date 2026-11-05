package com.flashcardsopensourceapp.app.navigation.settings

import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.scheduler.SchedulerSettingsRoute
import com.flashcardsopensourceapp.feature.settings.scheduler.createSchedulerSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.delete.DeleteCurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.workspace.overview.createWorkspaceOverviewViewModelFactory
import com.flashcardsopensourceapp.feature.settings.workspace.reset.ResetStudyProgressRoute
import com.flashcardsopensourceapp.feature.settings.workspace.settings.createWorkspaceSettingsViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerSettingsWorkspaceNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    composable(route = SettingsWorkspaceResetStudyProgressDestination.route) {
        val context = LocalContext.current
        val workspaceSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.settings.WorkspaceSettingsViewModel>(
            factory = createWorkspaceSettingsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                technicalErrorController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )
        val uiState by workspaceSettingsViewModel.uiState.collectAsStateWithLifecycle()

        ResetStudyProgressRoute(
            uiState = uiState,
            onOpenResetConfirmation = workspaceSettingsViewModel::openResetConfirmation,
            onDismissResetConfirmation = workspaceSettingsViewModel::dismissResetConfirmation,
            onResetConfirmationTextChange = workspaceSettingsViewModel::updateResetConfirmationText,
            onRequestResetProgress = workspaceSettingsViewModel::requestResetProgressAsync,
            onDismissResetPreviewAlert = workspaceSettingsViewModel::dismissResetPreviewAlert,
            onResetProgress = workspaceSettingsViewModel::resetProgressAsync,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceDeleteCurrentDestination.route) {
        val context = LocalContext.current
        val workspaceOverviewViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.overview.WorkspaceOverviewViewModel>(
            factory = createWorkspaceOverviewViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                technicalErrorController = appGraph.appMessageBus,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                applicationContext = context.applicationContext
            )
        )
        val uiState by workspaceOverviewViewModel.uiState.collectAsStateWithLifecycle()

        DeleteCurrentWorkspaceRoute(
            uiState = uiState,
            onRequestDeleteWorkspace = workspaceOverviewViewModel::requestDeleteWorkspaceAsync,
            onDismissDeletePreviewAlert = workspaceOverviewViewModel::dismissDeletePreviewAlert,
            onOpenDeleteConfirmation = workspaceOverviewViewModel::openDeleteConfirmation,
            onDeleteConfirmationTextChange = workspaceOverviewViewModel::updateDeleteConfirmationText,
            onDismissDeleteConfirmation = workspaceOverviewViewModel::dismissDeleteConfirmation,
            onDeleteWorkspace = workspaceOverviewViewModel::deleteWorkspaceAsync,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsWorkspaceSchedulerDestination.route) {
        val context = LocalContext.current
        val schedulerSettingsViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.scheduler.SchedulerSettingsViewModel>(
            factory = createSchedulerSettingsViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                technicalErrorController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
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
}
