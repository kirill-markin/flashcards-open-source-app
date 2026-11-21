package com.flashcardsopensourceapp.app.routes.settings

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.DialogNavigator
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.flashcardsopensourceapp.app.FirebaseAppInstrumentationTimeoutTest
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountAuthGraph
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountPostAuthDestination
import com.flashcardsopensourceapp.app.navigation.settings.SettingsAccountSignInEmailDestination
import com.flashcardsopensourceapp.app.navigation.settings.navigateToSocialPostAuth
import com.flashcardsopensourceapp.app.navigation.settings.registerSettingsAccountAuthNavGraph
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.core.observability.analytics.NoOpAnalytics
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsTheme
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDestinationUnavailableException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudPendingSocialSignIn
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialSignInPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.CloudSocialSignInRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthCreateNewButtonTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthNewWorkspaceCreateButtonTag
import com.flashcardsopensourceapp.feature.settings.cloud.cloudPostAuthNewWorkspaceNameFieldTag
import com.flashcardsopensourceapp.feature.settings.cloud.createCloudSignInViewModelFactory
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.cloudPostAuthExistingButtonTag
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.cloudPostAuthUnavailableWorkspaceNoticeTag
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInViewModel
import com.flashcardsopensourceapp.feature.settings.workspace.current.CurrentWorkspaceItemUiState
import java.io.File
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CloudPostAuthRouteTest : FirebaseAppInstrumentationTimeoutTest() {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun guestUpgradeDestinationReopensWorkspacePicker() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val capture = InstrumentationRegistry.getArguments().getString("captureGuestUpgrade")
        val legacyServer = capture == "before"
        val activity = composeRule.activity
        val graph = (activity.application as FlashcardsApplication).appGraph
        val removed = CloudWorkspaceSummary("removed-workspace", "Travel Spanish", 1_790_000_000_000L, false)
        val remaining = CloudWorkspaceSummary("remaining-workspace", "Personal", 1_789_000_000_000L, true)
        val credentials = StoredCloudCredentials("test-refresh", "test-id", Long.MAX_VALUE)
        val context = CloudWorkspaceLinkContext(
            userId = "test-user",
            email = "learner@example.com",
            credentials = credentials,
            workspaces = listOf(removed, remaining),
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            preferredWorkspaceId = null
        )
        var completions = 0
        val account = object : CloudAccountRepository by graph.cloudAccountRepository {
            override suspend fun sendCode(email: String) = CloudSendCodeResult.Verified(credentials)

            override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials) = context

            override suspend fun refreshGuestUpgradeWorkspaces(
                linkContext: CloudWorkspaceLinkContext,
                socialAttemptId: String?
            ): CloudWorkspaceLinkContext {
                assertEquals(credentials, linkContext.credentials)
                assertEquals(removed.workspaceId, linkContext.unavailableGuestUpgradeWorkspaceId)
                return linkContext.copy(workspaces = listOf(remaining), preferredWorkspaceId = remaining.workspaceId)
            }

            override suspend fun completeGuestUpgrade(
                linkContext: CloudWorkspaceLinkContext,
                selection: CloudWorkspaceLinkSelection,
                onGuestCompletionStarted: () -> Unit,
                onGuestCompletionFinished: () -> Unit
            ): CloudWorkspaceSummary {
                assertEquals(credentials, linkContext.credentials)
                completions += 1
                onGuestCompletionStarted()
                if (selection == CloudWorkspaceLinkSelection.Existing(removed.workspaceId)) {
                    val error = CloudRemoteException("Workspace not found", 404, null, "WORKSPACE_NOT_FOUND", null, null, false)
                    if (legacyServer) throw error
                    throw CloudGuestUpgradeDestinationUnavailableException(removed.workspaceId, error)
                }
                assertEquals(CloudWorkspaceLinkSelection.Existing(remaining.workspaceId), selection)
                onGuestCompletionFinished()
                return remaining
            }
        }
        val model = CloudSignInViewModel(
            cloudAccountRepository = account,
            syncRepository = object : SyncRepository by graph.syncRepository {
                override suspend fun syncNow() = Unit
            },
            messageController = TransientMessageController {},
            analytics = NoOpAnalytics,
            originSurface = null,
            signInStepSurface = AnalyticsSurface.SIGNIN,
            strings = object : SettingsStringResolver {
                override fun get(stringResId: Int, vararg formatArgs: Any) = activity.getString(stringResId, *formatArgs)
                override fun getQuantity(pluralsResId: Int, quantity: Int, vararg formatArgs: Any) =
                    activity.resources.getQuantityString(pluralsResId, quantity, *formatArgs)
                override fun locale() = Locale.ENGLISH
            }
        )
        composeRule.setContent {
            FlashcardsTheme {
                val uiState by model.postAuthUiState.collectAsState()
                LaunchedEffect(Unit) { model.sendCode() }
                CloudPostAuthRoute(
                    uiState = uiState,
                    onAutoContinue = model::startCompletePendingPostAuthIfNeeded,
                    onSelectWorkspace = model::startSelectPostAuthWorkspace,
                    onRetry = model::startRetryPostAuth,
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            model.postAuthUiState.value.mode == CloudPostAuthMode.CHOOSE_WORKSPACE
        }
        composeRule.onNodeWithTag(cloudPostAuthExistingButtonTag(removed.workspaceId)).performClick()
        val expectedMode = if (legacyServer) CloudPostAuthMode.FAILED else CloudPostAuthMode.CHOOSE_WORKSPACE
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            model.postAuthUiState.value.mode == expectedMode && completions == 1
        }
        composeRule.waitForIdle()
        if (capture == "before" || capture == "after") {
            val image = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
            val file = File(instrumentation.targetContext.filesDir, "guest-upgrade-$capture.png")
            file.outputStream().use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        }
        if (!legacyServer) {
            composeRule.onNodeWithTag(cloudPostAuthUnavailableWorkspaceNoticeTag).assertIsDisplayed()
            composeRule.onNodeWithTag(cloudPostAuthExistingButtonTag(removed.workspaceId)).assertDoesNotExist()
            composeRule.onNodeWithTag(cloudPostAuthCreateNewButtonTag).assertIsDisplayed()
            assertEquals(1, completions)
            composeRule.onNodeWithTag(cloudPostAuthExistingButtonTag(remaining.workspaceId)).performClick()
            composeRule.waitUntil(timeoutMillis = 5_000L) { model.postAuthUiState.value.completionToken != null }
            assertEquals(2, completions)
        }
    }

    @Test
    fun restoredPostAuthDestinationReopensGuestWorkspacePicker() {
        val activity = composeRule.activity
        val appGraph = (activity.application as FlashcardsApplication).appGraph
        val removed = CloudWorkspaceSummary("removed-workspace", "Travel Spanish", 1_790_000_000_000L, false)
        val remaining = CloudWorkspaceSummary("remaining-workspace", "Personal", 1_789_000_000_000L, true)
        val credentials = StoredCloudCredentials("test-refresh", "test-id", Long.MAX_VALUE)
        val rejectedContext = CloudWorkspaceLinkContext(
            userId = "test-user",
            email = "learner@example.com",
            credentials = credentials,
            workspaces = listOf(removed, remaining),
            postAuthRoute = CloudWorkspacePostAuthRoute.NONE,
            guestUpgradeMode = CloudGuestUpgradeMode.MERGE_REQUIRED,
            preferredWorkspaceId = null,
            unavailableGuestUpgradeWorkspaceId = removed.workspaceId
        )
        val attemptId = "retained-provider-attempt"
        var pending = CloudPendingSocialSignIn(
            provider = CloudSocialProvider.GOOGLE,
            localId = attemptId,
            attempt = null,
            nonce = null,
            redirectUri = null,
            expiresAtMillis = null,
            phase = CloudSocialSignInPhase.ACCEPTED,
            mailboxReason = null,
            mailboxCodeRequested = false,
            providerEmail = "learner@example.com",
            workspaceSelection = CloudWorkspaceLinkSelection.Existing(removed.workspaceId)
        )
        var preparationCalls = 0
        var refreshCalls = 0
        val socialSignIn = object : CloudSocialSignInRepository by appGraph.cloudSocialSignInRepository {
            override suspend fun resumePendingSignIn() = pending

            override suspend fun loadAuthMethods(): Nothing = error("The restored screen must not run sign-in entry.")

            override suspend fun prepareSignIn(
                attempt: String,
                onCredentialReceived: () -> Unit,
                onSessionAccepted: () -> Unit
            ): CloudWorkspaceLinkContext {
                assertEquals(attemptId, attempt)
                preparationCalls += 1
                pending = pending.copy(workspaceSelection = null)
                return rejectedContext
            }

            override suspend fun completeSignIn(
                attempt: String,
                selection: CloudWorkspaceLinkSelection,
                onGuestCompletionStarted: () -> Unit,
                onGuestCompletionFinished: () -> Unit
            ): Nothing = error("Restoration must wait for the user to choose a workspace.")
        }
        val account = object : CloudAccountRepository by appGraph.cloudAccountRepository {
            override suspend fun refreshGuestUpgradeWorkspaces(
                linkContext: CloudWorkspaceLinkContext,
                socialAttemptId: String?
            ): CloudWorkspaceLinkContext {
                assertEquals(rejectedContext, linkContext)
                assertEquals(attemptId, socialAttemptId)
                refreshCalls += 1
                return linkContext.copy(workspaces = listOf(remaining), preferredWorkspaceId = remaining.workspaceId)
            }
        }
        val owner = object : ViewModelStoreOwner {
            override val viewModelStore = ViewModelStore()
        }
        fun authController(store: ViewModelStore): NavHostController {
            return NavHostController(activity).apply {
                navigatorProvider.addNavigator(ComposeNavigator())
                navigatorProvider.addNavigator(DialogNavigator())
                setViewModelStore(store)
                setLifecycleOwner(activity)
            }
        }
        fun NavHostController.authGraph(scope: CoroutineScope) = createGraph(startDestination = "settings-test") {
            composable(route = "settings-test") {}
            registerSettingsAccountAuthNavGraph(
                appGraph = appGraph,
                navController = this@authGraph,
                coroutineScope = scope
            )
        }

        fun seedRestoredSignInViewModel(controller: NavHostController) {
            val authEntry = controller.getBackStackEntry(SettingsAccountAuthGraph.route)
            val factory = createCloudSignInViewModelFactory(
                cloudAccountRepository = account,
                cloudSocialSignInRepository = socialSignIn,
                syncRepository = appGraph.syncRepository,
                messageController = TransientMessageController {},
                analytics = NoOpAnalytics,
                pendingSignOutReport = appGraph.pendingSignOutReport,
                originSurface = null,
                signInStepSurface = AnalyticsSurface.SIGNIN,
                applicationContext = activity.applicationContext
            )
            ViewModelProvider.create(authEntry, factory)[CloudSignInViewModel::class]
        }

        lateinit var restoredController: NavHostController
        lateinit var savedPostAuthEntryId: String
        composeRule.setContent {
            FlashcardsTheme {
                val scope = rememberCoroutineScope()
                val controller = remember {
                    val originalStore = ViewModelStore()
                    val original = authController(originalStore)
                    original.graph = original.authGraph(scope)
                    original.navigate(SettingsAccountSignInEmailDestination.createRoute(AnalyticsSurface.SETTINGS))
                    original.navigateToSocialPostAuth(attemptId)
                    savedPostAuthEntryId = checkNotNull(original.currentBackStackEntry).id
                    val savedNavigation = checkNotNull(original.saveState())
                    originalStore.clear()

                    val restored = authController(owner.viewModelStore)
                    restored.restoreState(savedNavigation)
                    restored.graph = restored.authGraph(scope)
                    seedRestoredSignInViewModel(restored)
                    restoredController = restored
                    restored
                }
                CompositionLocalProvider(LocalViewModelStoreOwner provides owner) {
                    NavHost(navController = controller, graph = controller.graph)
                }
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            composeRule.onAllNodesWithTag(cloudPostAuthUnavailableWorkspaceNoticeTag)
                .fetchSemanticsNodes().size == 1
        }
        composeRule.onNodeWithTag(cloudPostAuthUnavailableWorkspaceNoticeTag).assertIsDisplayed()
        composeRule.onNodeWithTag(cloudPostAuthExistingButtonTag(removed.workspaceId)).assertDoesNotExist()
        composeRule.onNodeWithTag(cloudPostAuthExistingButtonTag(remaining.workspaceId)).assertIsDisplayed()
        composeRule.onNodeWithTag(cloudPostAuthCreateNewButtonTag).assertIsDisplayed()
        composeRule.runOnIdle {
            assertEquals(1, preparationCalls)
            assertEquals(1, refreshCalls)
            assertEquals(SettingsAccountPostAuthDestination.route, restoredController.currentDestination?.route)
            assertEquals(savedPostAuthEntryId, restoredController.currentBackStackEntry?.id)
            owner.viewModelStore.clear()
        }
    }

    @Test
    fun readyToAutoLinkTriggersAutoContinueAndDisablesBack() {
        var autoContinueCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.READY_TO_AUTO_LINK,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = "Personal",
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {
                        autoContinueCalls += 1
                    },
                    onSelectWorkspace = {},
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            autoContinueCalls == 1
        }
        composeRule.onNodeWithText("Preparing Personal...").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Back").assertIsNotEnabled()
        assertEquals(1, autoContinueCalls)
    }

    @Test
    fun chooseWorkspaceStateSelectsExistingWorkspace() {
        var selectedWorkspace: CloudWorkspaceLinkSelection? = null

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.CHOOSE_WORKSPACE,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = listOf(
                            CurrentWorkspaceItemUiState(
                                workspaceId = "workspace-1",
                                title = "Personal",
                                subtitle = "2 decks | 12 cards",
                                isSelected = true,
                                isCreateNew = false
                            ),
                            CurrentWorkspaceItemUiState(
                                workspaceId = "new",
                                title = "Create new workspace",
                                subtitle = "Start from an empty cloud workspace",
                                isSelected = false,
                                isCreateNew = true
                            )
                        ),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = { selection ->
                        selectedWorkspace = selection
                    },
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.onNodeWithText(
            "Choose a linked workspace to open on this Android device, or create a new one."
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Personal (Current)").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            selectedWorkspace == CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-1")
        }
        assertEquals(
            CloudWorkspaceLinkSelection.Existing(workspaceId = "workspace-1"),
            selectedWorkspace
        )
    }

    @Test
    fun chooseWorkspaceCreateNewAsksForWorkspaceName() {
        var selectedWorkspace: CloudWorkspaceLinkSelection? = null

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.CHOOSE_WORKSPACE,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = listOf(
                            CurrentWorkspaceItemUiState(
                                workspaceId = "workspace-1",
                                title = "Personal",
                                subtitle = "2 decks | 12 cards",
                                isSelected = true,
                                isCreateNew = false
                            ),
                            CurrentWorkspaceItemUiState(
                                workspaceId = "new",
                                title = "Create new workspace",
                                subtitle = "Start from an empty cloud workspace",
                                isSelected = false,
                                isCreateNew = true
                            )
                        ),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = { selection ->
                        selectedWorkspace = selection
                    },
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.onNodeWithTag(cloudPostAuthCreateNewButtonTag).performClick()
        composeRule.onNodeWithTag(cloudPostAuthNewWorkspaceCreateButtonTag).assertIsNotEnabled()
        composeRule.onNodeWithTag(cloudPostAuthNewWorkspaceNameFieldTag).performTextInput("  Spanish  ")
        composeRule.onNodeWithTag(cloudPostAuthNewWorkspaceCreateButtonTag).performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            selectedWorkspace != null
        }
        assertEquals(CloudWorkspaceLinkSelection.CreateNew(name = "Spanish"), selectedWorkspace)
    }

    @Test
    fun failedStateShowsRetryAndLogoutActions() {
        var retryCalls = 0
        var logoutCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.FAILED,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = false,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "Cloud sync could not finish.",
                        errorTechnicalDetails = "Cloud sync could not finish.",
                        errorTechnicalDetailsReportId = "test-cloud-post-auth-failure",
                        canRetry = true,
                        canLogout = true,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = {},
                    onRetry = {
                        retryCalls += 1
                    },
                    onFailureAction = {
                        logoutCalls += 1
                    },
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.onNodeWithText("Cloud sync could not finish.").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        composeRule.onNodeWithText("Log out").performClick()
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1 && logoutCalls == 1
        }
        assertEquals(1, retryCalls)
        assertEquals(1, logoutCalls)
    }

    @Test
    fun guestLocalRecoveryReadyStateShowsRecoveryCopyAndAutoContinues() {
        var autoContinueCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.READY_TO_AUTO_LINK,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = true,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "",
                        errorTechnicalDetails = null,
                        errorTechnicalDetailsReportId = null,
                        canRetry = false,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {
                        autoContinueCalls += 1
                    },
                    onSelectWorkspace = {},
                    onRetry = {},
                    onFailureAction = {},
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5_000L) {
            autoContinueCalls == 1
        }
        composeRule.onNodeWithText("Preparing recovered workspace...").assertIsDisplayed()
        assertTrue(
            composeRule.onAllNodesWithText("Create new workspace").fetchSemanticsNodes().isEmpty()
        )
        composeRule.onNodeWithContentDescription("Back").assertIsNotEnabled()
        assertEquals(1, autoContinueCalls)
    }

    @Test
    fun guestLocalRecoveryFailureShowsRetryWithoutLogoutAction() {
        var retryCalls = 0
        var failureActionCalls = 0

        composeRule.setContent {
            FlashcardsTheme {
                CloudPostAuthRoute(
                    uiState = CloudPostAuthUiState(
                        mode = CloudPostAuthMode.FAILED,
                        verifiedEmail = "user@example.com",
                        isGuestUpgrade = false,
                        isGuestLocalRecovery = true,
                        workspaces = emptyList(),
                        pendingWorkspaceTitle = null,
                        processingTitle = "",
                        processingMessage = "",
                        errorMessage = "Local data recovery failed. Try again; local data stays on this device.",
                        errorTechnicalDetails = "Local data recovery failed. Try again; local data stays on this device.",
                        errorTechnicalDetailsReportId = "test-cloud-post-auth-recovery-failure",
                        canRetry = true,
                        canLogout = false,
                        failureActionLabel = "Log out",
                        completionToken = null,
                        needsGuestUpgradeReselection = false
                    ),
                    onAutoContinue = {},
                    onSelectWorkspace = {},
                    onRetry = {
                        retryCalls += 1
                    },
                    onFailureAction = {
                        failureActionCalls += 1
                    },
                    onShowTechnicalDetails = { _, _ -> },
                    onBack = {},
                    canNavigateBack = true,
                    isFailureActionInFlight = false
                )
            }
        }

        composeRule.onNodeWithText(
            "Local data recovery failed. Try again; local data stays on this device."
        ).assertIsDisplayed()
        composeRule.onNodeWithText("Retry").performClick()
        assertTrue(
            composeRule.onAllNodesWithText("Log out").fetchSemanticsNodes().isEmpty()
        )
        composeRule.waitUntil(timeoutMillis = 5_000L) {
            retryCalls == 1
        }
        assertEquals(1, retryCalls)
        assertEquals(0, failureActionCalls)
    }
}
