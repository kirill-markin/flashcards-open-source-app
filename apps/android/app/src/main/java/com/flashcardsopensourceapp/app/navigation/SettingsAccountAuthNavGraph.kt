package com.flashcardsopensourceapp.app.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.navigation
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSendCodeNavigationOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInCodeRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInEmailRoute
import com.flashcardsopensourceapp.feature.settings.cloud.createCloudSignInViewModelFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal fun NavGraphBuilder.registerSettingsAccountAuthNavGraph(
    appGraph: AppGraph,
    navController: NavHostController,
    coroutineScope: CoroutineScope
) {
    navigation(
        startDestination = SettingsAccountSignInEmailDestination.route,
        route = SettingsAccountAuthGraph.route
    ) {
        composable(route = SettingsAccountSignInEmailDestination.route) { backStackEntry ->
            val context = LocalContext.current
            val authGraphBackStackEntry = settingsAccountAuthBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry
            )
            val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel>(
                viewModelStoreOwner = authGraphBackStackEntry,
                factory = createCloudSignInViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository,
                    messageController = appGraph.appMessageBus,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by signInViewModel.uiState.collectAsStateWithLifecycle()

            CloudSignInEmailRoute(
                uiState = uiState,
                onEmailChange = signInViewModel::updateEmail,
                onSendCode = {
                    coroutineScope.launch {
                        when (signInViewModel.sendCode()) {
                            CloudSendCodeNavigationOutcome.OtpRequired -> {
                                runAuthNavigationOnMainThread {
                                    navController.navigate(route = SettingsAccountSignInCodeDestination.route)
                                }
                            }

                            CloudSendCodeNavigationOutcome.Verified -> {
                                runAuthNavigationOnMainThread {
                                    navController.navigate(route = SettingsAccountPostAuthDestination.route)
                                }
                            }

                            CloudSendCodeNavigationOutcome.NoNavigation -> Unit
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountSignInCodeDestination.route) { backStackEntry ->
            val context = LocalContext.current
            val authGraphBackStackEntry = settingsAccountAuthBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry
            )
            val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel>(
                viewModelStoreOwner = authGraphBackStackEntry,
                factory = createCloudSignInViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository,
                    messageController = appGraph.appMessageBus,
                    applicationContext = context.applicationContext
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
                            runAuthNavigationOnMainThread {
                                navController.navigate(route = SettingsAccountPostAuthDestination.route)
                            }
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }

        composable(route = SettingsAccountPostAuthDestination.route) { backStackEntry ->
            val context = LocalContext.current
            val authGraphBackStackEntry = settingsAccountAuthBackStackEntry(
                navController = navController,
                currentBackStackEntry = backStackEntry
            )
            val signInViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel>(
                viewModelStoreOwner = authGraphBackStackEntry,
                factory = createCloudSignInViewModelFactory(
                    cloudAccountRepository = appGraph.cloudAccountRepository,
                    syncRepository = appGraph.syncRepository,
                    messageController = appGraph.appMessageBus,
                    applicationContext = context.applicationContext
                )
            )
            val uiState by signInViewModel.postAuthUiState.collectAsStateWithLifecycle()

            if (uiState.completionToken != null) {
                LaunchedEffect(uiState.completionToken) {
                    signInViewModel.acknowledgePostAuthCompletion()
                    runAuthNavigationOnMainThread {
                        navigateToSettingsAccountStatus(navController = navController)
                    }
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
                        runAuthNavigationOnMainThread {
                            navigateToSettingsAccountStatus(navController = navController)
                        }
                    }
                },
                onBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}

@Composable
private fun settingsAccountAuthBackStackEntry(
    navController: NavHostController,
    currentBackStackEntry: NavBackStackEntry
): NavBackStackEntry {
    return rememberRouteBackStackEntry(
        navController = navController,
        currentBackStackEntry = currentBackStackEntry,
        route = SettingsAccountAuthGraph.route
    )
}

private fun navigateToSettingsAccountStatus(navController: NavHostController) {
    navigateToTopLevelDestination(
        navController = navController,
        destination = SettingsDestination
    )
    navController.navigate(route = SettingsAccountStatusDestination.route)
}

/**
 * Navigation callbacks here run after suspend auth work. Keeping the actual
 * `NavController` mutation on `Dispatchers.Main.immediate` prevents the demo
 * bypass path from resuming on a worker thread and tripping Navigation's
 * lifecycle thread checks in Firebase Test Lab.
 */
private suspend fun runAuthNavigationOnMainThread(action: () -> Unit) {
    withContext(Dispatchers.Main.immediate) {
        action()
    }
}
