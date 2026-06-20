package com.flashcardsopensourceapp.app.navigation.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.app.navigation.AppPackageInfo
import com.flashcardsopensourceapp.app.navigation.SettingsDestination
import com.flashcardsopensourceapp.app.navigation.rememberRouteBackStackEntry
import com.flashcardsopensourceapp.app.notifications.loadNotificationDiagnosticsUiState
import com.flashcardsopensourceapp.core.ui.AppTechnicalError
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationDialog
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationShareEffect
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationViewModel
import com.flashcardsopensourceapp.feature.friendinvite.createFriendInvitationViewModelFactory
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionLottieConfigurationStore
import com.flashcardsopensourceapp.feature.review.reaction.TestAnimationsRoute
import com.flashcardsopensourceapp.feature.settings.review.ReviewAnimationsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsRoute
import com.flashcardsopensourceapp.feature.settings.SettingsFriendInviteAvailability
import com.flashcardsopensourceapp.feature.settings.TestSettingsRoute
import com.flashcardsopensourceapp.feature.settings.createSettingsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.device.DeviceDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.device.createDeviceDiagnosticsViewModelFactory
import com.flashcardsopensourceapp.feature.settings.feedback.FeedbackSettingsRoute
import com.flashcardsopensourceapp.feature.settings.language.LanguageSettingsRoute
import com.flashcardsopensourceapp.feature.settings.leaderboard.LeaderboardParticipationRoute
import com.flashcardsopensourceapp.feature.settings.leaderboard.createLeaderboardParticipationViewModelFactory
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsRoute
import com.flashcardsopensourceapp.feature.settings.notifications.NotificationDiagnosticsUiState
import com.flashcardsopensourceapp.feature.settings.settingsInviteFriendDisplayNameFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.current.CurrentWorkspaceRoute
import com.flashcardsopensourceapp.feature.settings.workspace.current.createCurrentWorkspaceViewModelFactory
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import org.xmlpull.v1.XmlPullParser

internal fun NavGraphBuilder.registerSettingsRootDestinations(
    appGraph: AppGraph,
    navController: NavHostController,
    packageInfo: AppPackageInfo,
    coroutineScope: CoroutineScope,
    reviewReactionLottieConfigurationStore: ReviewReactionLottieConfigurationStore
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
                testModeStore = appGraph.testModeStore,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                applicationContext = context.applicationContext
            )
        )
        val friendInvitationViewModel = viewModel<FriendInvitationViewModel>(
            viewModelStoreOwner = settingsRootBackStackEntry,
            factory = createFriendInvitationViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository
            )
        )
        val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()
        val friendInvitationUiState by friendInvitationViewModel.uiState.collectAsStateWithLifecycle()
        var isFriendInvitationDialogVisible by rememberSaveable { mutableStateOf(false) }

        LaunchedEffect(settingsViewModel) {
            settingsViewModel.refreshAccountContextAsync()
        }

        FriendInvitationShareEffect(
            uiState = friendInvitationUiState,
            onFriendInvitationShared = friendInvitationViewModel::markFriendInvitationShared
        )

        SettingsRoute(
            uiState = uiState,
            onOpenFriendInvite = {
                when (uiState.friendInviteAvailability) {
                    SettingsFriendInviteAvailability.AVAILABLE -> {
                        friendInvitationViewModel.clearFriendInvitationFailure()
                        isFriendInvitationDialogVisible = true
                    }

                    SettingsFriendInviteAvailability.SIGN_IN_REQUIRED -> {
                        navController.navigate(route = SettingsAccountSignInEmailDestination.route)
                    }

                    SettingsFriendInviteAvailability.LOADING -> Unit
                }
            },
            onOpenAccountStatus = {
                navController.navigate(route = SettingsAccountStatusDestination.route)
            },
            onOpenCurrentWorkspace = {
                navController.navigate(route = SettingsCurrentWorkspaceDestination.route)
            },
            onOpenReviewReminders = {
                navController.navigate(route = SettingsWorkspaceNotificationsDestination.route)
            },
            onOpenReviewAnimations = {
                navController.navigate(route = SettingsReviewAnimationsDestination.route)
            },
            onOpenLeaderboardParticipation = {
                navController.navigate(route = SettingsLeaderboardParticipationDestination.route)
            },
            onOpenLanguage = {
                navController.navigate(route = SettingsLanguageDestination.route)
            },
            onOpenAccess = {
                navController.navigate(route = SettingsAccessDestination.route)
            },
            onOpenDecks = {
                navController.navigate(route = SettingsWorkspaceDecksDestination.route)
            },
            onOpenTags = {
                navController.navigate(route = SettingsWorkspaceTagsDestination.route)
            },
            onOpenExport = {
                navController.navigate(route = SettingsWorkspaceExportDestination.route)
            },
            onOpenFeedback = {
                navController.navigate(route = SettingsFeedbackDestination.route)
            },
            onOpenLegal = {
                navController.navigate(route = SettingsAccountLegalDestination.route)
            },
            onOpenSupport = {
                navController.navigate(route = SettingsAccountSupportDestination.route)
            },
            onOpenOpenSource = {
                navController.navigate(route = SettingsAccountOpenSourceDestination.route)
            },
            onOpenScheduling = {
                navController.navigate(route = SettingsWorkspaceSchedulerDestination.route)
            },
            onOpenAgentConnections = {
                navController.navigate(route = SettingsAccountAgentConnectionsDestination.route)
            },
            onOpenServer = {
                navController.navigate(route = SettingsAccountServerDestination.route)
            },
            onOpenDeviceDiagnostics = {
                navController.navigate(route = SettingsDeviceDestination.route)
            },
            onOpenResetStudyProgress = {
                navController.navigate(route = SettingsWorkspaceResetStudyProgressDestination.route)
            },
            onOpenDeleteCurrentWorkspace = {
                navController.navigate(route = SettingsWorkspaceDeleteCurrentDestination.route)
            },
            onOpenDeleteAccount = {
                navController.navigate(route = SettingsAccountDangerZoneDestination.route)
            },
            onOpenTest = {
                navController.navigate(route = SettingsTestDestination.route)
            }
        )

        if (isFriendInvitationDialogVisible) {
            FriendInvitationDialog(
                uiState = friendInvitationUiState,
                displayNameFieldTag = settingsInviteFriendDisplayNameFieldTag,
                onCreateFriendInvitation = friendInvitationViewModel::createFriendInvitation,
                onClearFriendInvitationFailure = friendInvitationViewModel::clearFriendInvitationFailure,
                onDismiss = { isFriendInvitationDialogVisible = false }
            )
        }
    }

    composable(route = SettingsReviewAnimationsDestination.route) { backStackEntry ->
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
                testModeStore = appGraph.testModeStore,
                visibleAppScreenRepository = appGraph.visibleAppScreenController,
                applicationContext = context.applicationContext
            )
        )
        val uiState by settingsViewModel.uiState.collectAsStateWithLifecycle()

        LaunchedEffect(settingsViewModel) {
            settingsViewModel.refreshAccountContextAsync()
        }

        ReviewAnimationsRoute(
            reviewReactionAnimationsEnabled = uiState.reviewReactionAnimationsEnabled,
            canManageAccountPreferences = uiState.canManageAccountPreferences,
            onUpdateReviewReactionAnimationsEnabled = settingsViewModel::updateReviewReactionAnimationsEnabled,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsLeaderboardParticipationDestination.route) {
        val context = LocalContext.current
        val leaderboardParticipationViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.leaderboard.LeaderboardParticipationViewModel>(
            factory = createLeaderboardParticipationViewModelFactory(
                cloudAccountRepository = appGraph.cloudAccountRepository,
                applicationContext = context.applicationContext
            )
        )
        val uiState by leaderboardParticipationViewModel.uiState.collectAsStateWithLifecycle()

        LeaderboardParticipationRoute(
            uiState = uiState,
            onUpdateLeaderboardParticipation = leaderboardParticipationViewModel::updateLeaderboardParticipation,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsCurrentWorkspaceDestination.route) {
        val context = LocalContext.current
        val manageSignInMessage = stringResource(
            id = com.flashcardsopensourceapp.feature.settings.R.string.settings_current_workspace_manage_sign_in_message
        )
        val currentWorkspaceViewModel = viewModel<com.flashcardsopensourceapp.feature.settings.workspace.current.CurrentWorkspaceViewModel>(
            factory = createCurrentWorkspaceViewModelFactory(
                workspaceRepository = appGraph.workspaceRepository,
                cloudAccountRepository = appGraph.cloudAccountRepository,
                autoSyncEventRepository = appGraph.autoSyncEventRepository,
                messageController = appGraph.appMessageBus,
                technicalErrorController = appGraph.appMessageBus,
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
                    selection = com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection.Existing(
                        workspaceId = workspaceId
                    )
                )
            },
            onCreateWorkspace = {
                currentWorkspaceViewModel.switchWorkspaceAsync(
                    selection = com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection.CreateNew
                )
            },
            onWorkspaceNameChange = currentWorkspaceViewModel::updateWorkspaceNameDraft,
            onSaveWorkspaceName = currentWorkspaceViewModel::saveWorkspaceNameAsync,
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

    composable(route = SettingsLanguageDestination.route) {
        val context = LocalContext.current
        val supportedLanguageLabels = remember(context) {
            loadSupportedLanguageLabels(context = context)
        }
        LanguageSettingsRoute(
            supportedLanguageLabels = supportedLanguageLabels,
            onOpenAndroidLanguageSettings = {
                openAndroidAppLanguageSettings(context = context)
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsFeedbackDestination.route) {
        FeedbackSettingsRoute(
            onOpenFeedbackForm = {
                appGraph.feedbackPromptController.openSettingsFeedback()
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
                testModeStore = appGraph.testModeStore,
                messageController = appGraph.appMessageBus,
                applicationContext = context.applicationContext
            )
        )
        val uiState by deviceDiagnosticsViewModel.uiState.collectAsStateWithLifecycle()

        DeviceDiagnosticsRoute(
            uiState = uiState,
            onAppVersionTap = {
                deviceDiagnosticsViewModel.handleAppVersionTap(
                    nowMillis = SystemClock.elapsedRealtime()
                )
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsTestDestination.route) {
        val technicalErrorTitle = stringResource(id = R.string.technical_error_dialog_default_title)
        val technicalErrorMessage = stringResource(id = R.string.technical_error_dialog_default_message)
        val technicalErrorDetails = stringResource(id = R.string.technical_error_dialog_preview_details)

        TestSettingsRoute(
            onOpenAnimations = {
                navController.navigate(route = SettingsTestAnimationsDestination.route)
            },
            onShowTechnicalErrorDialogPreview = {
                appGraph.testTechnicalErrorDialogPreviewController.showTestPreview(
                    error = AppTechnicalError(
                        title = technicalErrorTitle,
                        message = technicalErrorMessage,
                        technicalDetails = technicalErrorDetails
                    )
                )
            },
            onOpenNotificationDiagnostics = {
                navController.navigate(route = SettingsNotificationDiagnosticsDestination.route)
            },
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsTestAnimationsDestination.route) {
        TestAnimationsRoute(
            reviewReactionLottieConfigurationStore = reviewReactionLottieConfigurationStore,
            onBack = {
                navController.popBackStack()
            }
        )
    }

    composable(route = SettingsNotificationDiagnosticsDestination.route) {
        val context = LocalContext.current
        val uiState by produceState<NotificationDiagnosticsUiState>(
            initialValue = NotificationDiagnosticsUiState.Loading,
            key1 = appGraph,
            key2 = context
        ) {
            value = try {
                loadNotificationDiagnosticsUiState(
                    context = context.applicationContext,
                    appGraph = appGraph
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                NotificationDiagnosticsUiState.Failed(
                    message = error.message ?: "Notification diagnostics failed."
                )
            }
        }

        NotificationDiagnosticsRoute(
            uiState = uiState,
            onBack = {
                navController.popBackStack()
            }
        )
    }
}

private fun loadSupportedLanguageLabels(context: Context): List<String> {
    val displayLocale = context.resources.configuration.locales[0] ?: Locale.getDefault()
    val parser = context.resources.getXml(com.flashcardsopensourceapp.app.R.xml.locales_config)
    val labels = mutableListOf<String>()

    try {
        while (parser.next() != XmlPullParser.END_DOCUMENT) {
            if (parser.eventType == XmlPullParser.START_TAG && parser.name == "locale") {
                val languageTag = parser.getAttributeValue(
                    "http://schemas.android.com/apk/res/android",
                    "name"
                )?.trim().orEmpty()
                require(languageTag.isNotEmpty()) {
                    "Supported Android locale entry is missing android:name."
                }
                labels += languageLabel(languageTag = languageTag, displayLocale = displayLocale)
            }
        }
    } finally {
        parser.close()
    }

    require(labels.isNotEmpty()) {
        "apps/android/app/src/main/res/xml/locales_config.xml must declare at least one supported locale."
    }
    return labels
}

private fun languageLabel(languageTag: String, displayLocale: Locale): String {
    val locale = Locale.forLanguageTag(languageTag)
    require(locale.language.isNotBlank()) {
        "Unsupported Android locale tag in locales_config.xml: $languageTag"
    }
    val displayName = locale.getDisplayName(displayLocale).replaceFirstChar { char ->
        if (char.isLowerCase()) {
            char.titlecase(displayLocale)
        } else {
            char.toString()
        }
    }
    return "$displayName ($languageTag)"
}

private fun openAndroidAppLanguageSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_LOCALE_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
    }
    context.startActivity(intent)
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
