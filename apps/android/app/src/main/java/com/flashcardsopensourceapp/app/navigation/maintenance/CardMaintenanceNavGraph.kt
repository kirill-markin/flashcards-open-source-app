package com.flashcardsopensourceapp.app.navigation.maintenance

import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.decodeRouteText
import com.flashcardsopensourceapp.app.navigation.encodeRouteText
import com.flashcardsopensourceapp.app.navigation.library.LibraryTagsDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountStatusDestination
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceKind
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceTarget
import java.util.UUID

internal data object CardMaintenanceDestination {
    private const val routePrefix = "library/card-maintenance"
    const val workspaceArgument = "workspaceId"
    const val kindArgument = "kind"
    const val targetArgument = "target"
    const val attemptArgument = "attemptId"
    const val routePattern = "$routePrefix/{$workspaceArgument}/{$kindArgument}/{$targetArgument}/{$attemptArgument}"

    fun createRoute(workspaceId: String, kind: CloudCardMaintenanceKind, target: String): String {
        return "$routePrefix/$workspaceId/${kind.wireValue}/${encodeRouteText(value = target)}/${UUID.randomUUID()}"
    }
}

internal fun NavGraphBuilder.registerCardMaintenanceDestination(
    appGraph: AppGraph,
    navController: NavHostController
) {
    composable(
        route = CardMaintenanceDestination.routePattern,
        arguments = listOf(
            navArgument(CardMaintenanceDestination.workspaceArgument) { type = NavType.StringType },
            navArgument(CardMaintenanceDestination.kindArgument) { type = NavType.StringType },
            navArgument(CardMaintenanceDestination.targetArgument) { type = NavType.StringType },
            navArgument(CardMaintenanceDestination.attemptArgument) { type = NavType.StringType }
        )
    ) { backStackEntry ->
        val arguments = requireNotNull(backStackEntry.arguments)
        val kind = CloudCardMaintenanceKind.entries.single { kind ->
            kind.wireValue == arguments.getString(CardMaintenanceDestination.kindArgument)
        }
        val target = CloudCardMaintenanceTarget(
            workspaceId = requireNotNull(arguments.getString(CardMaintenanceDestination.workspaceArgument)),
            kind = kind,
            target = decodeRouteText(value = requireNotNull(arguments.getString(CardMaintenanceDestination.targetArgument)))
        )
        val maintenanceViewModel = viewModel<CardMaintenanceViewModel>(
            factory = createCardMaintenanceViewModelFactory(
                repository = appGraph.cloudAccountRepository,
                target = target,
                attemptId = requireNotNull(arguments.getString(CardMaintenanceDestination.attemptArgument))
            )
        )
        val state by maintenanceViewModel.state.collectAsStateWithLifecycle()
        val finished = state as? CardMaintenanceState.Finished
        if (finished != null) {
            val success = cardMaintenanceSuccess(kind = kind, count = finished.affectedCardsCount)
            LaunchedEffect(finished) {
                if (navController.currentBackStackEntry == backStackEntry) {
                    appGraph.appMessageBus.showMessage(message = success)
                    navController.leaveCardMaintenance(kind = kind, didCommit = true)
                }
            }
        }

        CardMaintenanceRoute(
            kind = kind,
            state = state,
            onConfirmationTextChange = maintenanceViewModel::updateConfirmationText,
            onExecute = maintenanceViewModel::execute,
            onRetryPreview = maintenanceViewModel::retryPreview,
            onRetrySync = maintenanceViewModel::retrySync,
            onOpenAccountStatus = {
                navController.navigate(route = SettingsAccountStatusDestination.route)
            },
            onBack = {
                navController.leaveCardMaintenance(
                    kind = kind,
                    didCommit = (state as? CardMaintenanceState.RefreshNeeded)?.affectedCardsCount != null ||
                        finished != null
                )
            }
        )
    }
}

private fun NavHostController.leaveCardMaintenance(kind: CloudCardMaintenanceKind, didCommit: Boolean) {
    if (didCommit && kind == CloudCardMaintenanceKind.REMOVE_TAG) {
        popBackStack(route = LibraryTagsDestination.route, inclusive = false)
    } else {
        popBackStack()
    }
}
