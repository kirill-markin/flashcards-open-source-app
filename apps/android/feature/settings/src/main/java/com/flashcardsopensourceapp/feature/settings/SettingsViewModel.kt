package com.flashcardsopensourceapp.feature.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TestModeStore
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.isProductAnalyticsEnabled
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushRefusedException
import com.flashcardsopensourceapp.data.local.repository.ProductAnalyticsPreferencePushUndeliverableException
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.feature.settings.workspace.shared.workspaceUpdatedOnAnotherDeviceMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(
    workspaceRepository: WorkspaceRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    private val aiChatRepository: AiChatRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    testModeStore: TestModeStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private var pendingAutoSyncRequestId: String? = null
    private var settingsSignatureAtAutoSyncStart: SettingsVisibleSignature? = null
    private var lastVisibleAutoSyncChangeSignature: SettingsVisibleSignature? = null

    val uiState: StateFlow<SettingsUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings(),
        cloudAccountRepository.observeAccountPreferences(),
        combine(
            aiChatRepository.observeComposerSuggestionsEnabled(),
            aiChatRepository.observeOwnOpenAiKeySettings()
        ) { composerSuggestionsEnabled, ownOpenAiKeySettings ->
            SettingsAiPreferences(
                composerSuggestionsEnabled = composerSuggestionsEnabled,
                ownOpenAiKeyEnabled = ownOpenAiKeySettings.isEnabled
            )
        },
        testModeStore.observeIsEnabled()
    ) { metadata,
        cloudSettings,
        accountPreferences,
        aiPreferences,
        isTestModeEnabled ->
        val attentionSummary: SettingsAttentionSummary = makeSettingsAttentionSummary(
            issues = makeSettingsAttentionIssues(cloudState = cloudSettings.cloudState)
        )

        SettingsUiState(
            currentWorkspaceName = strings.resolveWorkspaceName(workspaceName = metadata.currentWorkspaceName),
            workspaceName = strings.resolveWorkspaceName(workspaceName = metadata.workspaceName),
            cardCount = metadata.cardCount,
            deckCount = metadata.deckCount,
            storageLabel = strings.resolveAppMetadataStorageLabel(storage = metadata.localStorage),
            syncStatusText = strings.resolveAppMetadataSyncStatusText(status = metadata.syncStatus),
            accountStatusTitle = when (cloudSettings.cloudState) {
                CloudAccountState.DISCONNECTED -> strings.get(R.string.settings_cloud_status_disconnected)
                CloudAccountState.LINKING_READY -> strings.get(R.string.settings_cloud_status_choose_workspace)
                CloudAccountState.GUEST -> strings.get(R.string.settings_cloud_status_guest_ai)
                CloudAccountState.LINKED -> cloudSettings.linkedEmail ?: strings.get(R.string.settings_cloud_status_linked)
            },
            accountStatusAttentionCount = attentionSummary.accountStatusRowCount,
            friendInviteAvailability = friendInviteAvailability(cloudState = cloudSettings.cloudState),
            reviewReactionAnimationsEnabled = accountPreferences.reviewReactionAnimationsEnabled,
            productAnalyticsEnabled = isProductAnalyticsEnabled(preferences = accountPreferences),
            aiChatComposerSuggestionsEnabled = aiPreferences.composerSuggestionsEnabled,
            ownOpenAiKeyEnabled = aiPreferences.ownOpenAiKeyEnabled,
            canManageAccountPreferences = canManageAccountPreferences(cloudState = cloudSettings.cloudState),
            isTestModeEnabled = isTestModeEnabled
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = SettingsUiState(
            currentWorkspaceName = strings.get(R.string.settings_loading),
            workspaceName = strings.get(R.string.settings_loading),
            cardCount = 0,
            deckCount = 0,
            storageLabel = strings.get(R.string.settings_device_storage_room_sqlite),
            syncStatusText = strings.get(R.string.settings_loading),
            accountStatusTitle = strings.get(R.string.settings_loading),
            accountStatusAttentionCount = 1,
            friendInviteAvailability = SettingsFriendInviteAvailability.LOADING,
            reviewReactionAnimationsEnabled = true,
            productAnalyticsEnabled = true,
            aiChatComposerSuggestionsEnabled = true,
            ownOpenAiKeyEnabled = aiChatRepository.currentOwnOpenAiKeySettings().isEnabled,
            canManageAccountPreferences = false,
            isTestModeEnabled = false
        )
    )

    init {
        observeAutoSyncDrivenSettingsChanges()
    }

    fun refreshAccountContextAsync() {
        viewModelScope.launch {
            try {
                cloudAccountRepository.refreshAccountContext()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageController.showMessage(message = strings.get(R.string.settings_account_preferences_refresh_failed))
            }
        }
    }

    fun updateReviewReactionAnimationsEnabled(isEnabled: Boolean) {
        viewModelScope.launch {
            try {
                cloudAccountRepository.updateAccountPreferences(
                    update = AccountPreferencesUpdate(
                        accentColor = null,
                        reviewReactionAnimationsEnabled = isEnabled,
                        productAnalyticsEnabled = null
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageController.showMessage(message = strings.get(R.string.settings_review_animations_update_failed))
                return@launch
            }

            try {
                cloudAccountRepository.refreshAccountContext()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageController.showMessage(message = strings.get(R.string.settings_account_preferences_refresh_failed))
            }
        }
    }

    /**
     * The local answer stands whatever the server says, so the failure message tells the person the
     * switch already took effect here and only the account copy is still owed.
     *
     * Only the ordinary failure mentions further attempts, because it is the only one that has any.
     * A recorded refusal dropped the pending push and blocks it being re-armed, so nothing sends
     * that answer again until the person toggles the switch themselves. An undeliverable opt-out has
     * no account to reach at all — the client has stopped flushing, so it never mints the guest
     * session the answer would be written to — and toggling again would find the same thing, so it
     * is told apart from the refusal rather than folded into it.
     *
     * It says the app keeps trying rather than that it will retry until this is saved, because one
     * case cannot get there: an opt-in whose own press failed on transport, over an account holding
     * an opt-out made elsewhere. Every later delivery carries `RECONCILIATION`, which the route
     * refuses for loosening the stored answer, and the client keeps the answer owed and re-offers it
     * without reporting anything — the guard working is not a failure. Left undistinguished on
     * purpose: nothing is pressing a control when that refusal arrives, so surfacing it would
     * interrupt with a verdict on an answer that is undelivered rather than doomed, and it stops
     * being refused the moment the account stops holding the stricter one.
     */
    fun updateProductAnalyticsEnabled(isEnabled: Boolean) {
        viewModelScope.launch {
            try {
                cloudAccountRepository.updateProductAnalyticsEnabled(enabled = isEnabled)
            } catch (error: CancellationException) {
                throw error
            } catch (_: ProductAnalyticsPreferencePushRefusedException) {
                messageController.showMessage(
                    message = strings.get(R.string.settings_product_analytics_update_refused)
                )
            } catch (_: ProductAnalyticsPreferencePushUndeliverableException) {
                messageController.showMessage(
                    message = strings.get(R.string.settings_product_analytics_update_undeliverable)
                )
            } catch (_: Exception) {
                messageController.showMessage(message = strings.get(R.string.settings_product_analytics_update_failed))
            }
        }
    }

    fun updateAiChatComposerSuggestionsEnabled(isEnabled: Boolean) {
        viewModelScope.launch {
            try {
                aiChatRepository.updateComposerSuggestionsEnabled(isEnabled = isEnabled)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageController.showMessage(
                    message = strings.get(R.string.settings_ai_chat_suggestions_update_failed)
                )
            }
        }
    }

    private fun observeAutoSyncDrivenSettingsChanges() {
        viewModelScope.launch {
            autoSyncEventRepository.observeAutoSyncEvents().collect { event ->
                when (event) {
                    is AutoSyncEvent.Requested -> {
                        handleAutoSyncRequested(request = event.request)
                    }

                    is AutoSyncEvent.Completed -> {
                        handleAutoSyncCompleted(completion = event.completion)
                    }
                }
            }
        }
    }

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_ROOT) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        settingsSignatureAtAutoSyncStart = buildSettingsVisibleSignature(uiState = uiState.value)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val settingsSignatureBeforeSync = settingsSignatureAtAutoSyncStart
        settingsSignatureAtAutoSyncStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_ROOT) {
            return
        }

        val currentSettingsSignature = buildSettingsVisibleSignature(uiState = uiState.value)
        if (settingsSignatureBeforeSync == null || settingsSignatureBeforeSync == currentSettingsSignature) {
            return
        }
        if (currentSettingsSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        lastVisibleAutoSyncChangeSignature = currentSettingsSignature
        messageController.showMessage(message = workspaceUpdatedOnAnotherDeviceMessage(strings = strings))
    }
}

private data class SettingsAiPreferences(
    val composerSuggestionsEnabled: Boolean,
    val ownOpenAiKeyEnabled: Boolean
)

private data class SettingsVisibleSignature(
    val currentWorkspaceName: String,
    val accountStatusTitle: String,
    val storageLabel: String
)

private fun buildSettingsVisibleSignature(uiState: SettingsUiState): SettingsVisibleSignature {
    return SettingsVisibleSignature(
        currentWorkspaceName = uiState.currentWorkspaceName,
        accountStatusTitle = uiState.accountStatusTitle,
        storageLabel = uiState.storageLabel
    )
}

private fun canManageAccountPreferences(cloudState: CloudAccountState): Boolean {
    return cloudState == CloudAccountState.LINKED || cloudState == CloudAccountState.GUEST
}

private fun friendInviteAvailability(cloudState: CloudAccountState): SettingsFriendInviteAvailability {
    return when (cloudState) {
        CloudAccountState.LINKED -> SettingsFriendInviteAvailability.AVAILABLE
        CloudAccountState.DISCONNECTED,
        CloudAccountState.LINKING_READY,
        CloudAccountState.GUEST -> SettingsFriendInviteAvailability.SIGN_IN_REQUIRED
    }
}

fun createSettingsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    aiChatRepository: AiChatRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    testModeStore: TestModeStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SettingsViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                aiChatRepository = aiChatRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                testModeStore = testModeStore,
                visibleAppScreenRepository = visibleAppScreenRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
